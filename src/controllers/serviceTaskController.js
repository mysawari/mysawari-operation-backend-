import mongoose from "mongoose";
import ServiceTask from "../models/ServiceTask.js";
import User from "../models/user.model.js";

const ACTIVE_STATUSES = ["pending", "assigned", "on_the_way", "reached"];

const LEADER_ROLES = [
  "SUPER_ADMIN",
  "ADMIN",
  "BRANCH_MANAGER",
  "OPERATIONS",
  "FLEET_MANAGER",
  "DRIVER_COORDINATOR",
];

const isLeader = (user) => LEADER_ROLES.includes(user.role);

// Drop price limit (whole rupees) — must match MAX_DROP_CHARGE in the app
const MAX_DROP_CHARGE = 100000;
// Single payment / refund limit (safety net against typos)
const MAX_PAYMENT_AMOUNT = 1000000;

/* ================================================================== */
/*  SMALL HELPERS                                                      */
/* ================================================================== */

// Error with an HTTP status, thrown from helpers and sent as JSON
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sendError = (res, next, error) => {
  if (error instanceof HttpError) {
    return res.status(error.status).json({ success: false, message: error.message });
  }
  return next(error);
};

const num = (v) => Number(v) || 0;
const money = (v) => Math.round(num(v) * 100) / 100; // 2 decimals (paise)

// Positive amount, or null if invalid
const parseAmount = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_PAYMENT_AMOUNT) return null;
  return money(n);
};

const rupees = (n) => `₹${money(n).toLocaleString("en-IN")}`;

// The Handover model your app already registers
const HandoverModel = () => mongoose.model("Handover");

// Same business? (company id match, or same businessName as a fallback)
const isSameBusiness = async (req, companyRef) => {
  if (!companyRef) return false;
  const companyId = req.user.company || req.user._id;
  if (String(companyRef) === String(companyId)) return true;
  if (!req.user.businessName) return false;
  return !!(await User.exists({
    _id: companyRef,
    businessName: req.user.businessName,
  }));
};

const toCard = (task) => ({
  id: String(task._id),
  bookingId: String(task.booking),
  bookingCode: task.bookingCode,
  type: task.type,
  status: task.status,

  customerName: task.customerName,
  mobileNumber: task.mobileNumber,
  vehicleName: task.vehicleName,
  vehicleNumber: task.vehicleNumber,
  address: task.address,
  landmark: task.landmark || "",
  scheduledAt: task.scheduledAt,

  // NEW: price the leader set for this drop
  dropCharge: num(task.dropCharge),

  assignedTo: task.assignedTo
    ? {
        _id: String(task.assignedTo._id),
        fullName: task.assignedTo.fullName || "",
        mobileNumber: task.assignedTo.mobileNumber || "",
      }
    : null,
  assignedAt: task.assignedAt,

  startedAt: task.startedAt,
  startLocation: task.startLocation,
  reachedAt: task.reachedAt,
  reachLocation: task.reachLocation,
  completedAt: task.completedAt,
  completeLocation: task.completeLocation,

  cancelledAt: task.cancelledAt,
  cancelReason: task.cancelReason,
});

/* ================================================================== */
/*  BILL HELPERS                                                       */
/*                                                                     */
/*  The bill lives on the Handover:                                    */
/*    payment.totalAmount          what the customer owes in total     */
/*    payment.amountReceivedNow    collected after booking             */
/*    payment.bookingAmountPaid    paid at booking                     */
/*    payment.refundedAmount       given back                          */
/*    payment.billSummary.*        snapshot the app shows              */
/*                                                                     */
/*  The drop charge is kept in payment.billSummary.dropCharge and is   */
/*  part of totalAmount. Changing it adds / removes only the           */
/*  DIFFERENCE, so a Change Drop never counts the price twice.         */
/* ================================================================== */

// Rebuild billSummary from payment (same maths as the pre("save") hook)
const syncBillSummary = (h) => {
  const p = h.payment || {};
  const totalAmount = money(p.totalAmount);
  const bookingPaid = money(p.bookingAmountPaid);
  const receivedNow = money(p.amountReceivedNow);
  const refunded = money(p.refundedAmount);
  const totalPaid = money(bookingPaid + receivedNow - refunded);

  h.set("payment.billSummary.totalFare", money(p.totalFare));
  h.set("payment.billSummary.fastTagPayable", money(p.fastTagPayableAmount));
  h.set("payment.billSummary.securityDeposit", money(p.securityDeposit));
  h.set("payment.billSummary.extraCharges", money(p.extraCharges));
  h.set("payment.billSummary.discountAmount", money(p.discountAmount));
  h.set("payment.billSummary.totalAmount", totalAmount);
  h.set("payment.billSummary.bookingAmountPaid", bookingPaid);
  h.set("payment.billSummary.amountReceivedNow", receivedNow);
  h.set("payment.billSummary.refundedAmount", refunded);
  h.set("payment.billSummary.totalCollected", totalPaid); // net, after refunds
  h.set("payment.billSummary.balanceAmount", Math.max(0, money(totalAmount - totalPaid)));
  h.set("payment.billSummary.refundDue", Math.max(0, money(totalPaid - totalAmount)));
};

// Set the drop charge → move totalAmount by the difference
const applyDropCharge = (h, newCharge) => {
  if (h.handoverStatus === "cancelled") {
    throw new HttpError(409, "This handover is cancelled. The bill can't be changed.");
  }
  const oldCharge = money(h.payment?.billSummary?.dropCharge);
  const charge = money(newCharge);
  const delta = money(charge - oldCharge);

  if (delta !== 0) {
    h.set("payment.totalAmount", Math.max(0, money(num(h.payment.totalAmount) + delta)));
  }
  h.set("payment.billSummary.dropCharge", charge);
  return { oldCharge, newCharge: charge, delta };
};

// What the app gets back
const toBill = (doc) => {
  const h = doc?.toObject ? doc.toObject() : doc || {};
  const p = h.payment || {};
  const bs = p.billSummary || {};
  return {
    handoverId: String(h._id),
    bookingId: h.bookingId ? String(h.bookingId) : "",
    dropCharge: money(bs.dropCharge),
    totalAmount: money(p.totalAmount),
    balanceAmount: money(p.balanceAmount),
    refundDue: money(p.refundDue),
    refundedAmount: money(p.refundedAmount),
    paymentStatus: p.paymentStatus || "pending",
    paymentMethod: p.paymentMethod || "",
    paymentBreakdown: {
      cash: money(p.paymentBreakdown?.cash),
      phonePe: money(p.paymentBreakdown?.phonePe),
      razorpay: money(p.paymentBreakdown?.razorpay),
    },
    refundBreakdown: {
      cash: money(p.refundBreakdown?.cash),
      phonePe: money(p.refundBreakdown?.phonePe),
    },
    billSummary: {
      totalFare: money(bs.totalFare),
      fastTagPayable: money(bs.fastTagPayable),
      pickupCharge: money(bs.pickupCharge),
      dropCharge: money(bs.dropCharge),
      securityDeposit: money(bs.securityDeposit),
      extraCharges: money(bs.extraCharges),
      discountAmount: money(bs.discountAmount),
      totalAmount: money(bs.totalAmount),
      bookingAmountPaid: money(bs.bookingAmountPaid),
      amountReceivedNow: money(bs.amountReceivedNow),
      refundedAmount: money(bs.refundedAmount),
      totalCollected: money(bs.totalCollected),
      balanceAmount: money(bs.balanceAmount),
      refundDue: money(bs.refundDue),
    },
  };
};

/**
 * Load the handover, change it, save it — safely.
 * h.increment() makes the save fail if someone else saved the same bill
 * in between (VersionError). We then reload and try again, so two people
 * collecting money at the same moment can never overwrite each other.
 */
const BILL_RETRIES = 3;

const updateBill = async (filter, mutate) => {
  const Handover = HandoverModel();

  for (let attempt = 1; ; attempt++) {
    const h = await Handover.findOne({ ...filter, isDeleted: { $ne: true } });
    if (!h) throw new HttpError(404, "Handover (bill) not found.");

    const result = mutate(h); // may throw HttpError
    syncBillSummary(h);
    h.increment();

    try {
      // Only validate what we changed, so old records with missing
      // fields don't block a payment
      await h.save({ validateModifiedOnly: true });
      return { handover: h, result };
    } catch (err) {
      if (err?.name === "VersionError") {
        if (attempt < BILL_RETRIES) continue;
        throw new HttpError(
          409,
          "The bill was just changed by someone else. Pull down to refresh.",
        );
      }
      throw err;
    }
  }
};

/**
 * Who may touch this bill?
 *   leader        → same business
 *   driver        → has a (not cancelled) drop task for this booking
 *   leaderOnly    → drivers refused
 */
const checkBillAccess = async (req, handoverId, { leaderOnly = false } = {}) => {
  if (!mongoose.isValidObjectId(handoverId)) {
    throw new HttpError(400, "Invalid handover id.");
  }

  const handover = await HandoverModel()
    .findOne({ _id: handoverId, isDeleted: { $ne: true } })
    .select("company bookingId handoverStatus")
    .lean();

  if (!handover) throw new HttpError(404, "Handover (bill) not found.");

  if (isLeader(req.user) && (await isSameBusiness(req, handover.company))) {
    return handover;
  }

  if (leaderOnly) {
    throw new HttpError(403, "Only team leaders can do this.");
  }

  const isMyDrop =
    handover.bookingId &&
    (await ServiceTask.exists({
      booking: handover.bookingId,
      type: "drop",
      assignedTo: req.user._id,
      status: { $ne: "cancelled" },
    }));

  if (!isMyDrop) {
    throw new HttpError(403, "You don't have access to this bill.");
  }
  return handover;
};

// "cash" | "phonepe" | "razorpay" → paymentBreakdown key
const PAY_KEYS = { cash: "cash", phonepe: "phonePe", razorpay: "razorpay" };
const REFUND_KEYS = { cash: "cash", phonepe: "phonePe" };

/* ================================================================== */
/*  TASK LIST / DETAILS                                                */
/* ================================================================== */

export const getServiceTasks = async (req, res, next) => {
  try {
    const companyId = req.user.company || req.user._id;

    const scope = req.query.scope === "all" ? "all" : "mine";
    const type = req.query.type === "drop" ? "drop" : "pickup";
    const status = req.query.status === "completed" ? "completed" : "active";

    const filter = { type };

    if (scope === "mine") {
      // "My Tasks" = only tasks assigned to the logged-in user.
      // No company filter here. The task's company is the
      // leader's id, so a driver would never match it.
      filter.assignedTo = req.user._id;
    } else {
      // "All Tasks" = everything in my company
      filter.company = companyId;
    }

    // Count active + completed (for the chip numbers in the app)
    const [activeCount, completedCount] = await Promise.all([
      ServiceTask.countDocuments({ ...filter, status: { $in: ACTIVE_STATUSES } }),
      ServiceTask.countDocuments({ ...filter, status: "completed" }),
    ]);

    // Fetch the list
    let tasks;
    if (status === "completed") {
      tasks = await ServiceTask.find({ ...filter, status: "completed" })
        .sort({ completedAt: -1 }) // latest finished first
        .limit(100)
        .populate("assignedTo", "fullName mobileNumber")
        .lean();
    } else {
      tasks = await ServiceTask.find({ ...filter, status: { $in: ACTIVE_STATUSES } })
        .sort({ scheduledAt: 1 }) // earliest reach time first
        .limit(100)
        .populate("assignedTo", "fullName mobileNumber")
        .lean();
    }

    return res.status(200).json({
      success: true,
      data: tasks.map(toCard),
      counts: { active: activeCount, completed: completedCount },
    });
  } catch (error) {
    next(error);
  }
};

export const getServiceTaskById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid task id." });
    }

    // Found if it's in my company OR assigned to me
    const task = await ServiceTask.findOne({
      _id: id,
      $or: [
        { company: req.user.company || req.user._id },
        { assignedTo: req.user._id },
      ],
    })
      .populate("assignedTo", "fullName mobileNumber")
      .lean();

    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found." });
    }

    return res.status(200).json({ success: true, data: toCard(task) });
  } catch (error) {
    next(error);
  }
};

export const getTeamMembers = async (req, res, next) => {
  try {
    if (!isLeader(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Only team leaders can assign tasks.",
      });
    }

    const members = await User.find({
      businessName: req.user.businessName,
      accountStatus: "ACTIVE",
      deletedAt: null,
    })
      .select("fullName mobileNumber role")
      .sort({ fullName: 1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: members.map((m) => ({
        _id: String(m._id),
        fullName: m.fullName,
        mobileNumber: m.mobileNumber,
        role: m.role,
      })),
    });
  } catch (error) {
    next(error);
  }
};

export const assignServiceTask = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { assignedTo, scheduledAt } = req.body || {};
    const companyId = req.user.company || req.user._id;

    // 1. Only team leaders
    if (!isLeader(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Only team leaders can assign tasks.",
      });
    }

    // 2. Check ids
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid task id." });
    }
    if (!mongoose.isValidObjectId(assignedTo)) {
      return res.status(400).json({ success: false, message: "Please select a team member." });
    }

    // 3. Member must be an active user of the same business
    const member = await User.findOne({
      _id: assignedTo,
      businessName: req.user.businessName,
      accountStatus: "ACTIVE",
      deletedAt: null,
    })
      .select("_id")
      .lean();

    if (!member) {
      return res.status(404).json({ success: false, message: "Team member not found." });
    }

    // 4. What to save
    const update = {
      assignedTo: member._id,
      assignedBy: req.user._id,
      assignedAt: new Date(),
      status: "assigned",
    };

    if (scheduledAt) {
      const reachTime = new Date(scheduledAt);
      if (isNaN(reachTime.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid reach time." });
      }
      update.scheduledAt = reachTime;
    }

    // 5. Save — only if the trip hasn't started yet.
    const task = await ServiceTask.findOneAndUpdate(
      {
        _id: id,
        company: companyId,
        status: { $in: ["pending", "assigned"] },
      },
      { $set: update },
      { new: true },
    )
      .populate("assignedTo", "fullName mobileNumber")
      .lean();

    // 6. Nothing updated → tell why
    if (!task) {
      const exists = await ServiceTask.exists({ _id: id, company: companyId });

      if (!exists) {
        return res.status(404).json({ success: false, message: "Task not found." });
      }

      return res.status(409).json({
        success: false,
        message: "Trip already started. It can't be reassigned now.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Team member assigned.",
      data: toCard(task),
    });
  } catch (error) {
    next(error);
  }
};

/* ================================================================== */
/*  Start / Reached / Complete        (assigned team member)           */
/*                                                                     */
/*  PATCH /api/v1/service/:id/start      assigned   → on_the_way       */
/*  PATCH /api/v1/service/:id/reach      on_the_way → reached          */
/*  PATCH /api/v1/service/:id/complete   reached    → completed        */
/* ================================================================== */
const STEPS = {
  start: {
    from: ["assigned", "pending"],
    to: "on_the_way",
    time: "startedAt",
    place: "startLocation",
  },
  reach: {
    from: ["on_the_way"],
    to: "reached",
    time: "reachedAt",
    place: "reachLocation",
  },
  complete: {
    from: ["reached"],
    to: "completed",
    time: "completedAt",
    place: "completeLocation",
  },
};

// Used in error messages
const STATUS_TEXT = {
  pending: "not assigned yet",
  assigned: "not started yet",
  on_the_way: "already started",
  reached: "already reached",
  completed: "already completed",
  cancelled: "cancelled",
};

const runStep = (stepKey) => async (req, res, next) => {
  try {
    const step = STEPS[stepKey];
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid task id." });
    }

    const locationName = String(req.body?.locationName || "")
      .trim()
      .slice(0, 300);

    const task = await ServiceTask.findOneAndUpdate(
      { _id: id, assignedTo: req.user._id, status: { $in: step.from } },
      {
        $set: {
          status: step.to,
          [step.time]: new Date(),
          [step.place]: locationName,
        },
      },
      { new: true },
    )
      .populate("assignedTo", "fullName mobileNumber")
      .lean();

    if (!task) {
      const existing = await ServiceTask.findById(id)
        .select("status assignedTo")
        .lean();

      if (!existing) {
        return res.status(404).json({ success: false, message: "Task not found." });
      }

      if (String(existing.assignedTo) !== String(req.user._id)) {
        return res.status(403).json({
          success: false,
          message: "Only the assigned team member can update this task.",
        });
      }

      return res.status(409).json({
        success: false,
        message: `This task is ${STATUS_TEXT[existing.status]}. Pull down to refresh.`,
      });
    }

    return res.status(200).json({ success: true, data: toCard(task) });
  } catch (error) {
    next(error);
  }
};

export const startServiceTask = runStep("start");
export const reachServiceTask = runStep("reach");
export const completeServiceTask = runStep("complete");

/* ================================================================== */
/*  PATCH /api/v1/service/:id/cancel                                   */
/*                                                                     */
/*  Who: the assigned driver (own task) OR a team leader (company).   */
/*  Body: { reason?: string }                                          */
/*                                                                     */
/*  CHANGED: cancelling a drop that set a price also takes that price  */
/*  back off the bill (drop charge → 0).                               */
/* ================================================================== */
export const cancelServiceTask = async (req, res, next) => {
  try {
    const { id } = req.params;
    const companyId = req.user.company || req.user._id;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid task id." });
    }

    const whoCanCancel = isLeader(req.user)
      ? { $or: [{ company: companyId }, { assignedTo: req.user._id }] }
      : { assignedTo: req.user._id };

    const task = await ServiceTask.findOneAndUpdate(
      { _id: id, ...whoCanCancel, status: { $in: ACTIVE_STATUSES } },
      {
        $set: {
          status: "cancelled",
          cancelledAt: new Date(),
          cancelledBy: req.user._id,
          cancelReason: String(req.body?.reason || "")
            .trim()
            .slice(0, 300),
        },
      },
      { new: true },
    )
      .populate("assignedTo", "fullName mobileNumber")
      .lean();

    if (!task) {
      const existing = await ServiceTask.findById(id)
        .select("status company assignedTo")
        .lean();

      if (!existing) {
        return res.status(404).json({ success: false, message: "Task not found." });
      }

      const allowed =
        String(existing.assignedTo) === String(req.user._id) ||
        (isLeader(req.user) && String(existing.company) === String(companyId));

      if (!allowed) {
        return res.status(403).json({
          success: false,
          message: "You can only cancel tasks assigned to you.",
        });
      }

      return res.status(409).json({
        success: false,
        message: `This task is ${STATUS_TEXT[existing.status]}. It can't be cancelled.`,
      });
    }

    // Drop price came from this task → remove it from the bill.
    // (A drop charge that was on the bill from the booking, before any
    //  drop task, is left alone because the task has no dropCharge.)
    let bill = null;
    let billWarning = "";
    if (task.type === "drop" && num(task.dropCharge) > 0) {
      try {
        const { handover } = await updateBill({ bookingId: task.booking }, (h) =>
          applyDropCharge(h, 0),
        );
        bill = toBill(handover);
      } catch (err) {
        billWarning = ` Bill not updated: ${err.message || "error"}.`;
      }
    }

    return res.status(200).json({
      success: true,
      message: `Task cancelled.${billWarning}`,
      data: toCard(task),
      bill,
    });
  } catch (error) {
    next(error);
  }
};

/* ================================================================== */
/*  GET /api/v1/service/by-bookings?bookingIds=a,b,c&type=drop         */
/* ================================================================== */
export const getTasksForBookings = async (req, res, next) => {
  try {
    const type = req.query.type === "pickup" ? "pickup" : "drop";
    const ids = String(req.query.bookingIds || "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => mongoose.isValidObjectId(s))
      .slice(0, 100);

    if (!ids.length) {
      return res.status(200).json({ success: true, data: {} });
    }

    const companyId = req.user.company || req.user._id;

    const tasks = await ServiceTask.find({
      booking: { $in: ids },
      type,
      ...(isLeader(req.user)
        ? { $or: [{ company: companyId }, { assignedTo: req.user._id }] }
        : { assignedTo: req.user._id }),
    })
      .populate("assignedTo", "fullName mobileNumber")
      .lean();

    const data = {};
    tasks.forEach((t) => {
      data[String(t.booking)] = toCard(t);
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/* ================================================================== */
/*  POST /api/v1/service/drop-task          (team leaders)             */
/*                                                                     */
/*  Body:                                                              */
/*    bookingId    (required)                                          */
/*    handoverId   (recommended) whose bill gets the drop price        */
/*    address      (required)                                          */
/*    landmark     (optional)                                          */
/*    scheduledAt  (required)  ISO date                                */
/*    assignedTo   (required)  driver's user id                        */
/*    dropCharge   (NEW)       ₹, 0 – 100000. Leave out = bill unchanged*/
/*                                                                     */
/*  Response: { data: taskCard, bill: {...} | null }                   */
/* ================================================================== */
export const saveDropTask = async (req, res, next) => {
  try {
    const { bookingId, handoverId, address, landmark, scheduledAt, assignedTo, dropCharge } =
      req.body || {};
    const companyId = req.user.company || req.user._id;

    // 1. Only team leaders
    if (!isLeader(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Only team leaders can add a drop.",
      });
    }

    // 2. Check the form
    if (!mongoose.isValidObjectId(bookingId)) {
      return res.status(400).json({ success: false, message: "Invalid booking." });
    }

    const cleanAddress = String(address || "").trim().slice(0, 300);
    if (!cleanAddress) {
      return res
        .status(400)
        .json({ success: false, message: "Drop location is required." });
    }

    const reachTime = new Date(scheduledAt);
    if (!scheduledAt || isNaN(reachTime.getTime())) {
      return res
        .status(400)
        .json({ success: false, message: "Please choose the date and time." });
    }

    if (!mongoose.isValidObjectId(assignedTo)) {
      return res
        .status(400)
        .json({ success: false, message: "Please select a driver." });
    }

    // NEW: drop price (null = not sent → bill is not touched)
    let charge = null;
    if (dropCharge !== undefined && dropCharge !== null && dropCharge !== "") {
      const n = Number(dropCharge);
      if (!Number.isFinite(n) || n < 0 || n > MAX_DROP_CHARGE) {
        return res.status(400).json({
          success: false,
          message: `Drop price must be between ₹0 and ${rupees(MAX_DROP_CHARGE)}.`,
        });
      }
      charge = Math.round(n);
    }

    // 3. Driver must be an active user of the same business
    const member = await User.findOne({
      _id: assignedTo,
      businessName: req.user.businessName,
      accountStatus: "ACTIVE",
      deletedAt: null,
    })
      .select("_id")
      .lean();

    if (!member) {
      return res.status(404).json({ success: false, message: "Driver not found." });
    }

    // 4. Booking
    const Booking = mongoose.model("Booking");
    const booking = await Booking.findById(bookingId)
      .select("bookingCode customerName mobileNumber vehicleName vehicleNumber")
      .lean();

    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }

    // 5. NEW: the handover (bill) — checked BEFORE saving the task,
    //    so a bad bill never leaves a half-saved drop behind
    let handover = null;
    if (charge !== null) {
      const filter = mongoose.isValidObjectId(handoverId)
        ? { _id: handoverId }
        : { bookingId };

      handover = await HandoverModel()
        .findOne({ ...filter, isDeleted: { $ne: true } })
        .select("bookingId company handoverStatus")
        .lean();

      if (!handover) {
        return res.status(404).json({
          success: false,
          message: "No handover (bill) found for this booking.",
        });
      }
      if (String(handover.bookingId) !== String(bookingId)) {
        return res.status(400).json({
          success: false,
          message: "This handover doesn't belong to this booking.",
        });
      }
      if (!(await isSameBusiness(req, handover.company))) {
        return res.status(403).json({
          success: false,
          message: "You don't have access to this bill.",
        });
      }
      if (handover.handoverStatus === "cancelled") {
        return res.status(409).json({
          success: false,
          message: "This handover is cancelled. A drop can't be added.",
        });
      }
    }

    const assignFields = {
      address: cleanAddress,
      landmark: String(landmark || "").trim().slice(0, 200),
      scheduledAt: reachTime,
      assignedTo: member._id,
      assignedBy: req.user._id,
      assignedAt: new Date(),
      status: "assigned",
      ...(charge !== null ? { dropCharge: charge } : {}),
    };

    // 6. Existing drop task for this booking?
    const existing = await ServiceTask.findOne({ booking: bookingId, type: "drop" })
      .select("status")
      .lean();

    if (existing && ["on_the_way", "reached", "completed"].includes(existing.status)) {
      return res.status(409).json({
        success: false,
        message: `This drop is ${STATUS_TEXT[existing.status]}. It can't be changed now.`,
      });
    }

    let taskId;

    if (existing) {
      const reopen =
        existing.status === "cancelled"
          ? {
              startedAt: null,
              startLocation: "",
              reachedAt: null,
              reachLocation: "",
              completedAt: null,
              completeLocation: "",
              cancelledAt: null,
              cancelledBy: null,
              cancelReason: "",
            }
          : {};

      const updated = await ServiceTask.findOneAndUpdate(
        {
          _id: existing._id,
          status: { $in: ["pending", "assigned", "cancelled"] },
        },
        { $set: { ...assignFields, ...reopen } },
        { new: true },
      ).lean();

      if (!updated) {
        return res.status(409).json({
          success: false,
          message: "The drop just started. Pull down to refresh.",
        });
      }
      taskId = updated._id;
    } else {
      const [created] = await ServiceTask.create([
        {
          company: companyId,
          booking: booking._id,
          bookingCode:
            booking.bookingCode || String(booking._id).slice(-8).toUpperCase(),
          type: "drop",
          customerName: booking.customerName || "",
          mobileNumber: booking.mobileNumber || "",
          vehicleName: booking.vehicleName || "",
          vehicleNumber: booking.vehicleNumber || "",
          ...assignFields,
        },
      ]);
      taskId = created._id;
    }

    const task = await ServiceTask.findById(taskId)
      .populate("assignedTo", "fullName mobileNumber")
      .lean();

    // 7. NEW: put the drop price on the bill
    let bill = null;
    let billWarning = "";
    if (charge !== null && handover) {
      try {
        const { handover: saved } = await updateBill({ _id: handover._id }, (h) =>
          applyDropCharge(h, charge),
        );
        bill = toBill(saved);
      } catch (err) {
        // Drop is saved; only the bill failed — tell the app
        billWarning = ` Bill not updated: ${err.message || "error"}.`;
      }
    }

    return res.status(existing ? 200 : 201).json({
      success: true,
      message: `${existing ? "Drop updated." : "Drop added and assigned."}${billWarning}`,
      data: toCard(task),
      bill,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A drop was just added for this booking. Pull down to refresh.",
      });
    }
    sendError(res, next, error);
  }
};

/* ================================================================== */
/*  NEW — BILL & PAYMENTS on a handover                                */
/*                                                                     */
/*  GET   /service/handover/:handoverId/bill          leader / driver  */
/*  PATCH /service/handover/:handoverId/drop-charge   leader           */
/*  POST  /service/handover/:handoverId/payment       leader / driver  */
/*  POST  /service/handover/:handoverId/refund        leader           */
/*                                                                     */
/*  Every response: { success, message, bill }                         */
/* ================================================================== */

// GET — current bill
export const getHandoverBill = async (req, res, next) => {
  try {
    const { handoverId } = req.params;
    await checkBillAccess(req, handoverId);

    const handover = await HandoverModel().findById(handoverId).lean();

    return res.status(200).json({ success: true, bill: toBill(handover) });
  } catch (error) {
    sendError(res, next, error);
  }
};

// PATCH — change only the drop price   Body: { dropCharge }
export const updateDropCharge = async (req, res, next) => {
  try {
    const { handoverId } = req.params;
    await checkBillAccess(req, handoverId, { leaderOnly: true });

    const n = Number(req.body?.dropCharge);
    if (!Number.isFinite(n) || n < 0 || n > MAX_DROP_CHARGE) {
      throw new HttpError(
        400,
        `Drop price must be between ₹0 and ${rupees(MAX_DROP_CHARGE)}.`,
      );
    }
    const charge = Math.round(n);

    const { handover, result } = await updateBill({ _id: handoverId }, (h) =>
      applyDropCharge(h, charge),
    );

    // Keep the drop task's price in step (if there is a live one)
    if (handover.bookingId) {
      await ServiceTask.updateOne(
        { booking: handover.bookingId, type: "drop", status: { $ne: "cancelled" } },
        { $set: { dropCharge: charge } },
      );
    }

    return res.status(200).json({
      success: true,
      message:
        result.delta === 0
          ? "Drop price unchanged."
          : `Drop price set to ${rupees(charge)}.`,
      bill: toBill(handover),
    });
  } catch (error) {
    sendError(res, next, error);
  }
};

/**
 * POST — collect money from the customer
 * Body: { amount, method: "cash" | "phonepe" | "razorpay" }
 * Can't collect more than the balance due.
 */
export const addHandoverPayment = async (req, res, next) => {
  try {
    const { handoverId } = req.params;
    await checkBillAccess(req, handoverId);

    const amount = parseAmount(req.body?.amount);
    if (amount === null) {
      throw new HttpError(400, "Please enter a valid amount.");
    }

    const method = String(req.body?.method || "").trim().toLowerCase();
    const key = PAY_KEYS[method];
    if (!key) {
      throw new HttpError(400, "Payment method must be cash, phonepe or razorpay.");
    }

    const { handover } = await updateBill({ _id: handoverId }, (h) => {
      if (h.handoverStatus === "cancelled") {
        throw new HttpError(409, "This handover is cancelled.");
      }

      const p = h.payment;
      const totalPaid =
        num(p.bookingAmountPaid) + num(p.amountReceivedNow) - num(p.refundedAmount);
      const balance = Math.max(0, money(num(p.totalAmount) - totalPaid));

      if (balance <= 0) {
        throw new HttpError(409, "Nothing is due. The bill is already paid.");
      }
      if (amount > balance) {
        throw new HttpError(
          400,
          `Customer owes only ${rupees(balance)}. Enter ${rupees(balance)} or less.`,
        );
      }

      // Was anything paid before, by a DIFFERENT method?
      const bd = p.paymentBreakdown || {};
      const usedOther = Object.entries(PAY_KEYS).some(
        ([m, k]) => m !== method && num(bd[k]) > 0,
      );

      h.set("payment.amountReceivedNow", money(num(p.amountReceivedNow) + amount));
      h.set(`payment.paymentBreakdown.${key}`, money(num(bd[key]) + amount));
      h.set("payment.paymentMethod", usedOther ? "mixed" : method);
      h.set("payment.customPaymentDate", new Date());
    });

    return res.status(200).json({
      success: true,
      message: `${rupees(amount)} received by ${method}.`,
      bill: toBill(handover),
    });
  } catch (error) {
    sendError(res, next, error);
  }
};

/**
 * POST — give money back to the customer   (leaders only)
 * Body: { amount, method: "cash" | "phonepe" }
 * Can't refund more than the refund due (overpayment).
 */
export const addHandoverRefund = async (req, res, next) => {
  try {
    const { handoverId } = req.params;
    await checkBillAccess(req, handoverId, { leaderOnly: true });

    const amount = parseAmount(req.body?.amount);
    if (amount === null) {
      throw new HttpError(400, "Please enter a valid amount.");
    }

    const method = String(req.body?.method || "").trim().toLowerCase();
    const key = REFUND_KEYS[method];
    if (!key) {
      throw new HttpError(400, "Refund method must be cash or phonepe.");
    }

    const { handover } = await updateBill({ _id: handoverId }, (h) => {
      const p = h.payment;
      const totalPaid =
        num(p.bookingAmountPaid) + num(p.amountReceivedNow) - num(p.refundedAmount);
      const refundDue = Math.max(0, money(totalPaid - num(p.totalAmount)));

      if (refundDue <= 0) {
        throw new HttpError(409, "No refund is due on this bill.");
      }
      if (amount > refundDue) {
        throw new HttpError(
          400,
          `Refund due is only ${rupees(refundDue)}. Enter ${rupees(refundDue)} or less.`,
        );
      }

      const rb = p.refundBreakdown || {};
      h.set("payment.refundedAmount", money(num(p.refundedAmount) + amount));
      h.set(`payment.refundBreakdown.${key}`, money(num(rb[key]) + amount));
    });

    return res.status(200).json({
      success: true,
      message: `${rupees(amount)} refunded by ${method}.`,
      bill: toBill(handover),
    });
  } catch (error) {
    sendError(res, next, error);
  }
};