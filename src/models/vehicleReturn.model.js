import mongoose from "mongoose";

const inspectionItemSchema = new mongoose.Schema(
  {
    itemName: {
      type: String,
      required: true,
      trim: true,
    },

    condition: {
      type: String,
      enum: ["good", "minor", "major"],
      required: true,
    },

    note: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { _id: false },
);

/* ==========================
   DAMAGE COST DETAILS
========================== */

const damageCostDetailsSchema = new mongoose.Schema(
  {
    repairEstimate: {
      type: Number,
      default: 0,
      min: 0,
    },

    repairDays: {
      type: Number,
      default: 0,
      min: 0,
    },

    actualRepairCost: {
      type: Number,
      default: 0,
      min: 0,
    },

    repairBill: {
      type: String,
      default: "",
    },

    repairedAt: {
      type: Date,
    },

    remarks: {
      type: String,
      default: "",
      trim: true,
    },

    status: {
      type: String,
      enum: ["Pending", "Under Repair", "Completed", "Closed"],
      default: "Pending",
    },
  },
  { _id: false },
);

/* ==========================
   MAINTENANCE DETAILS
   FIX: the controller has always written `maintenanceDetails`, but the
   field was missing from this schema, so Mongoose (strict mode) silently
   dropped it on every return.
========================== */

const maintenanceDetailsSchema = new mongoose.Schema(
  {
    required: {
      type: Boolean,
      default: false,
    },

    reason: {
      type: String,
      default: "",
      trim: true,
    },

    estimatedDays: {
      type: Number,
      default: 0,
      min: 0,
    },

    estimatedCompletionDate: {
      type: Date,
      default: null,
    },
  },
  { _id: false },
);

/* ==========================
   PAYMENT SETTLEMENT DETAILS
========================== */

const settlementDetailsSchema = new mongoose.Schema(
  {
    /*
      Existing pending amount
      from booking/handover
    */
    pendingAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    /*
      Auto calculated
      editable by executive
    */
    lateReturnFine: {
      type: Number,
      default: 0,
      min: 0,
    },

    /*
      Auto calculated
      editable by executive
    */
    extraKmFine: {
      type: Number,
      default: 0,
      min: 0,
    },

    /*
      Fuel shortage amount
    */
    fuelUsageAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    /*
      Damage estimate included
      for settlement calculations
    */
    damageAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    /*
      Pending + fines + fuel + damage
    */
    totalBalanceAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    /*
      Amount collected
      during return
    */
    amountCollected: {
      type: Number,
      default: 0,
      min: 0,
    },

    paymentMode: {
      type: String,
      enum: ["Cash", "PhonePe", "Razorpay", "Mixed"],
      default: "Cash",
    },

    /*
      FIX: the app sends a LIST of UPI references, but this was a single
      String with a 4-digit regex, so it could never hold them (and the
      controller never saved it). Now an array; empty strings are
      tolerated so old documents that stored "" still validate on re-save.
    */
    upiLast4: {
      type: [String],
      default: [],
      validate: {
        validator: (arr) =>
          (arr || []).every((v) => !v || /^\d{4}$/.test(String(v))),
        message: "Each UPI reference must be exactly 4 digits",
      },
    },

    paymentBreakdown: {
      cash: {
        type: Number,
        default: 0,
        min: 0,
      },

      phonePe: {
        type: Number,
        default: 0,
        min: 0,
      },

      razorpay: {
        type: Number,
        default: 0,
        min: 0,
      },
    },

    /*
      Remaining amount
    */
    finalBalance: {
      type: Number,
      default: 0,
      min: 0,
    },

    /*
      Mandatory if
      finalBalance > 0
    */
    balanceReason: {
      type: String,
      default: "",
      trim: true,
    },

    status: {
      type: String,
      enum: ["Collected", "Partially Collected", "Pending Collection"],
      default: "Pending Collection",
    },

    settledAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
);

/* ==========================
   MAIN SCHEMA
========================== */

const vehicleReturnSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    handover: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Handover",
      required: true,
      unique: true,
    },

    vehicle: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
      index: true,
    },

    /*
      NEW: car or bike — decided on the server from the Vehicle document
      at return time. Drives which checklist/photos the return contains.
      Old documents without it are treated as "car".
    */
    vehicleCategory: {
      type: String,
      enum: ["car", "bike"],
      default: "car",
      index: true,
    },

    customerName: {
      type: String,
      default: "",
      trim: true,
    },

    fuelLevel: {
      type: Number,
      min: 0,
      max: 7,
    },

    kilometersAtReturn: {
      type: Number,
      required: true,
      min: 0,
    },

    hasDamage: {
      type: Boolean,
      default: false,
    },

    damageNotes: {
      type: String,
      default: "",
      trim: true,
    },

    inspection: {
      type: [inspectionItemSchema],
      default: [],
    },

    /* ======================
       VEHICLE RETURN IMAGES
    ====================== */

    images: {
      // Common to car & bike
      vehicleFront: { type: String, default: "" },
      vehicleRear: { type: String, default: "" },
      vehicleLeft: { type: String, default: "" },
      vehicleRight: { type: String, default: "" },
      toolkit: { type: String, default: "" },

      // Car only
      tyreFrontLeft: { type: String, default: "" },
      tyreFrontRight: { type: String, default: "" },
      tyreRearLeft: { type: String, default: "" },
      tyreRearRight: { type: String, default: "" },
      spareTyre: { type: String, default: "" },

      // Bike only (NEW)
      tyreFront: { type: String, default: "" },
      tyreRear: { type: String, default: "" },
      helmet: { type: String, default: "" },
    },

    /* ======================
       DAMAGE IMAGES
    ====================== */

    damageImages: {
      type: [String],
      default: [],
    },
    additionalImages: {
      type: [String],
      default: [],
    },

    /* ======================
       DAMAGE DETAILS
    ====================== */

    damageCostDetails: {
      type: damageCostDetailsSchema,
      default: () => ({}),
    },

    /* ======================
       MAINTENANCE DETAILS
    ====================== */

    maintenanceDetails: {
      type: maintenanceDetailsSchema,
      default: () => ({}),
    },

    /* ======================
       RETURN SETTLEMENT
    ====================== */

    settlementDetails: {
      type: settlementDetailsSchema,
      default: () => ({}),
    },

    returnStatus: {
      type: String,
      enum: ["completed"],
      default: "completed",
    },
    receivedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    receivingTime: {
      type: Date,
    },

    scheduledReturnTime: {
      type: Date,
    },

    timeStatus: {
      type: String,
      enum: ["Before Time", "On Time", "Delayed"],
    },

    delayInMinutes: {
      type: Number,
      default: 0,
    },

    delayText: {
      type: String,
      default: "",
    },
  },

  {
    timestamps: true,
  },
);

/* ==========================
   VALIDATIONS
========================== */

vehicleReturnSchema.pre("save", async function () {
  const settlement = this.settlementDetails || {};

  if (settlement.finalBalance > 0 && !settlement.balanceReason?.trim()) {
    throw new Error("Reason is required when balance amount remains");
  }
});

/* ==========================
   INDEXES
========================== */

// Pending collections
vehicleReturnSchema.index({
  "settlementDetails.status": 1,
});

// Outstanding balances
vehicleReturnSchema.index({
  "settlementDetails.finalBalance": 1,
});

// Damage workflow
vehicleReturnSchema.index({
  "damageCostDetails.status": 1,
});

// Company dashboard
vehicleReturnSchema.index({
  company: 1,
  createdAt: -1,
});

// Vehicle history
vehicleReturnSchema.index({
  vehicle: 1,
  createdAt: -1,
});

// Customer collections
vehicleReturnSchema.index({
  customerName: 1,
});

export default mongoose.model("VehicleReturn", vehicleReturnSchema);