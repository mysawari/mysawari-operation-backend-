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

export const getServiceTasks = async (req, res, next) => {
  try {
    const companyId = req.user.company || req.user._id;

    const scope = req.query.scope === "all" ? "all" : "mine";
    const type = req.query.type === "drop" ? "drop" : "pickup";
    const status = req.query.status === "completed" ? "completed" : "active";

    const filter = { type };

    if (scope === "mine") {
      // "My Tasks" = only tasks assigned to the logged-in user.
      // CHANGED: no company filter here. The task's company is the
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

    // CHANGED: found if it's in my company OR assigned to me
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
    //    The status check is inside the update, so it stays safe even
    //    if the driver taps Start at the same moment.
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
/*  NEW — Start / Reached / Complete        (assigned team member)     */
/*                                                                     */
/*  PATCH /api/v1/service/:id/start      assigned   → on_the_way       */
/*  PATCH /api/v1/service/:id/reach      on_the_way → reached          */
/*  PATCH /api/v1/service/:id/complete   reached    → completed        */
/*                                                                     */
/*  Body: { locationName?: "Ganeshguri, Dispur" }                      */
/*  Saves the time + location name and moves to the next status.      */
/* ================================================================== */
const STEPS = {
  start: {
    from: ["assigned", "pending"], // pending = assigned to me, status not updated
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

    // Update only if: it's MY task AND it's at the right step.
    // The check is inside the update, so a double tap can't save twice.
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

    // Nothing updated → tell the app why
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
/*  NEW — PATCH /api/v1/service/:id/cancel                             */
/*                                                                     */
/*  Who: the assigned driver (own task) OR a team leader (company).   */
/*  Body: { reason?: string }                                          */
/*  Works on any task that isn't completed or already cancelled.       */
/* ================================================================== */
export const cancelServiceTask = async (req, res, next) => {
  try {
    const { id } = req.params;
    const companyId = req.user.company || req.user._id;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid task id." });
    }

    // Leader: any task in the company (or their own). Driver: own task only.
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

    return res.status(200).json({
      success: true,
      message: "Task cancelled.",
      data: toCard(task),
    });
  } catch (error) {
    next(error);
  }
};

/* ================================================================== */
/*  NEW — GET /api/v1/service/by-bookings?bookingIds=a,b,c&type=drop   */
/*                                                                     */
/*  Receive Desk: one call returns the drop (or pickup) task for every */
/*  booking on screen.                                                 */
/*  Response: { data: { "<bookingId>": card, ... } }                   */
/*  Bookings with no task are simply missing from `data`.             */
/*  Leaders see company tasks; others see only tasks assigned to them.*/
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
/*  NEW — POST /api/v1/service/drop-task          (team leaders)       */
/*                                                                     */
/*  "Add Drop" / "Edit Drop" popup on the Receive Desk.               */
/*  Body:                                                              */
/*    bookingId    (required)                                          */
/*    address      (required)  drop location                           */
/*    landmark     (optional)                                          */
/*    scheduledAt  (required)  reach-by time, ISO date                 */
/*    assignedTo   (required)  driver's user id                        */
/*                                                                     */
/*  • No drop task yet       → creates one, already assigned           */
/*  • pending / assigned     → updates location, time, driver          */
/*  • cancelled              → re-opens it as a fresh assigned drop    */
/*  • started / completed    → refused (409)                           */
/*  No payment fields are touched.                                     */
/* ================================================================== */
export const saveDropTask = async (req, res, next) => {
  try {
    const { bookingId, address, landmark, scheduledAt, assignedTo } =
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

    // 4. Booking (uses the "Booking" model your app already registers)
    const Booking = mongoose.model("Booking");
    const booking = await Booking.findById(bookingId)
      .select("bookingCode customerName mobileNumber vehicleName vehicleNumber")
      .lean();

    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }

    const assignFields = {
      address: cleanAddress,
      landmark: String(landmark || "").trim().slice(0, 200),
      scheduledAt: reachTime,
      assignedTo: member._id,
      assignedBy: req.user._id,
      assignedAt: new Date(),
      status: "assigned",
    };

    // 5. Existing drop task for this booking?
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
      // Update (pending / assigned) or re-open (cancelled)
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

      // Status check inside the update: safe if the driver taps Start now
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
      // Create a new drop task, already assigned
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

    return res.status(existing ? 200 : 201).json({
      success: true,
      message: existing ? "Drop updated." : "Drop added and assigned.",
      data: toCard(task),
    });
  } catch (error) {
    // Two leaders saving at the same moment → unique index (booking + type)
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A drop was just added for this booking. Pull down to refresh.",
      });
    }
    next(error);
  }
};