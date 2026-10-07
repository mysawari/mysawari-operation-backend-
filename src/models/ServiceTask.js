import mongoose from "mongoose";

const serviceTaskSchema = new mongoose.Schema(
  {
    // ---------- Which booking / company ----------
    company: { type: mongoose.Schema.Types.ObjectId, required: true },
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
    },
    bookingCode: { type: String, default: "" },

    // "pickup" or "drop"
    type: { type: String, enum: ["pickup", "drop"], required: true },

    // ---------- Copied from booking (shown on the card) ----------
    customerName: { type: String, default: "" },
    mobileNumber: { type: String, default: "" },
    vehicleName: { type: String, default: "" },
    vehicleNumber: { type: String, default: "" },
    address: { type: String, default: "" },

    // Time the team member should reach the location
    scheduledAt: { type: Date, required: true },

    // ---------- Workflow ----------
    status: {
      type: String,
      enum: [
        "pending",
        "assigned",
        "on_the_way",
        "reached",
        "completed",
        "cancelled",
      ],
      default: "pending",
    },

    // Team leader assigns this person
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    assignedAt: { type: Date, default: null },

    // Team member taps Start
    startedAt: { type: Date, default: null },
    startLocation: { type: String, default: "" },

    // Team member taps Reached
    reachedAt: { type: Date, default: null },
    reachLocation: { type: String, default: "" },

    // Team member taps Complete
    completedAt: { type: Date, default: null },
    completeLocation: { type: String, default: "" },
  },
  { timestamps: true },
);


serviceTaskSchema.index({ booking: 1, type: 1 }, { unique: true });

const ServiceTask = mongoose.model("ServiceTask", serviceTaskSchema);

export default ServiceTask;
