import mongoose from "mongoose";
import ServiceTask from "../models/ServiceTask.js";

// Statuses shown under "Active" in the app
const ACTIVE_STATUSES = ["pending", "assigned", "on_the_way", "reached"];

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

    // Base filter: my company + pickup or drop
    const filter = { company: companyId, type };

    // "My Tasks" = only tasks assigned to the logged-in user
    if (scope === "mine") {
      filter.assignedTo = req.user._id;
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

    const task = await ServiceTask.findOne({
      _id: id,
      company: req.user.company || req.user._id,
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