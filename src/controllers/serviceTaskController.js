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