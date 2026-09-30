import mongoose from "mongoose";

const extendBookingSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      index: true,
    },
    handoverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Handover",
    },
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    mobileNumber: {
      type: String,
    },
    additionalDays: {
      type: Number,
    },
    newToDate: {
      type: Date,
    },
    additionalAmount: {
      type: Number,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "declined", "accepted"],
      default: "pending",
    },
    rejectReason: {
      type: String,
      default: "",
    },
    reason: {
      type: String,
      default: "",
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

export default mongoose.model("ExtendBooking", extendBookingSchema, "extend_booking");
