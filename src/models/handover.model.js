import mongoose from "mongoose";

const extensionBillSchema = new mongoose.Schema(
  {
    billNumber: {
      type: Number,
      required: true,
    },

    // NEW: "extension" = drop date moved later (fare goes UP)
    //      "reduction" = drop date moved earlier (fare goes DOWN)
    billType: {
      type: String,
      enum: ["extension", "reduction"],
      default: "extension",
    },

    previousDropDateTime: { type: Date, required: true },
    newDropDateTime: { type: Date, required: true },

    previousNumberOfDays: { type: Number, required: true },
    newNumberOfDays: { type: Number, required: true },

    // Positive = extended further, negative = shortened
    extraDays: { type: Number, required: true },

    // Always stored as a POSITIVE number.
    // billType decides whether it was added to or deducted from totalFare.
    extensionAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // How much of "amountReceivedNow" was collected at the moment
    // this specific extension was made (for a per-bill receipt view)
    amountCollected: {
      type: Number,
      default: 0,
      min: 0,
    },

    // NEW: refund handed back to the customer with this bill
    amountRefunded: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Snapshot of totalFare right after this bill was applied, so
    // historic entries always render correctly even if later logic
    // or fields change
    totalFareAfterThisBill: {
      type: Number,
      required: true,
      min: 0,
    },

    reason: {
      type: String,
      default: "",
      trim: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true },
);

const vehicleExchangeImageSchema = new mongoose.Schema(
  {
    vehicleFront: {
      type: String,
      default: "",
    },

    vehicleRear: {
      type: String,
      default: "",
    },

    vehicleLeft: {
      type: String,
      default: "",
    },

    vehicleRight: {
      type: String,
      default: "",
    },
    additional: { type: String, default: "" },
  },
  { _id: false },
);

const handoverSchema = new mongoose.Schema(
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

    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      index: true,
    },

    customer: {
      fullName: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100,
      },

      mobileNumber: {
        type: String,
        required: true,
        trim: true,
      },

      alternateMobileNumber: {
        type: String,
        trim: true,
        default: "",
      },

      occupation: {
        type: String,
        trim: true,
        default: "",
      },

      destination: {
        type: String,
        required: true,
        trim: true,
        maxlength: 150,
      },
    },

    identity: {
      aadhaarNumber: {
        type: String,
        required: true,
        trim: true,
      },

      drivingLicenseNumber: {
        type: String,
        required: true,
        trim: true,
        uppercase: true,
      },
    },

    vehicle: {
      vehicleId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Vehicle",
        required: true,
      },

      vehicleName: {
        type: String,
        required: true,
        trim: true,
      },

      vehicleNumber: {
        type: String,
        required: true,
        trim: true,
        uppercase: true,
      },

      vehicleColor: {
        type: String,
        trim: true,
        default: "",
      },

      handoverKm: {
        type: Number,
        required: true,
        min: 0,
        default: 0,
      },
      spareAvailable: {
        type: Boolean,
        required: true,
        default: false,
      },

      toolkitAvailable: {
        type: Boolean,
        required: true,
        default: false,
      },
    },

    vehicleHistory: [
      {
        oldVehicle: {
          vehicleId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Vehicle",
          },

          vehicleName: {
            type: String,
            default: "",
          },

          vehicleNumber: {
            type: String,
            default: "",
          },
        },

        newVehicle: {
          vehicleId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Vehicle",
          },

          vehicleName: {
            type: String,
            default: "",
          },

          vehicleNumber: {
            type: String,
            default: "",
          },
        },

        // Photos captured when the customer received
        // the replacement vehicle.
        exchangeImages: {
          type: vehicleExchangeImageSchema,
          default: () => ({}),
        },

        changedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },

        changedAt: {
          type: Date,
          default: Date.now,
        },

        reason: {
          type: String,
          default: "",
          trim: true,
        },
      },
    ],

    trip: {
      tripType: {
        type: String,
        enum: ["local", "outstation"],
        default: "local",
      },

      numberOfDays: {
        type: Number,
        required: true,
        min: 1,
      },

      pickupDateTime: {
        type: Date,
        required: true,
      },

      dropDateTime: {
        type: Date,
        required: true,
      },
    },
    membershipDiscount: {
      type: Number,
      default: 0,
      min: 0,
    },

    payment: {
      fuelLevel: {
        type: Number,
        min: 0,
        max: 7,
        default: 1,
      },

      fastTagBalance: {
        type: Number,
        default: 0,
        min: 0,
      },

      fastTagPayableAmount: {
        type: Number,
        default: 0,
        min: 0,
      },

      totalFare: {
        type: Number,
        required: true,
        min: 0,
      },

      securityDeposit: {
        type: Number,
        default: 0,
        min: 0,
      },

      extraCharges: {
        type: Number,
        default: 0,
        min: 0,
      },
      discountAmount: {
        type: Number,
        default: 0,
        min: 0,
      },

      totalAmount: {
        type: Number,
        required: true,
        min: 0,
      },

      bookingAmountPaid: {
        type: Number,
        default: 0,
        min: 0,
      },

      amountReceivedNow: {
        type: Number,
        required: true,
        min: 0,
      },

      // NEW: cumulative money returned to the customer
      refundedAmount: {
        type: Number,
        default: 0,
        min: 0,
      },

      // NEW: how the refunds were paid out
      refundBreakdown: {
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
      },

      balanceAmount: {
        type: Number,
        default: 0,
        min: 0,
      },

      // NEW: customer has paid more than totalAmount and
      // this much is still owed back to them
      refundDue: {
        type: Number,
        default: 0,
        min: 0,
      },

      paymentMethod: {
        type: String,
        enum: ["cash", "phonepe", "razorpay", "mixed"],
        required: true,
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

      paymentStatus: {
        type: String,
        enum: ["paid", "partial", "pending"],
        default: "pending",
      },

      customPaymentDate: {
        type: Date,
        default: null,
      },

      billSummary: {
        totalFare: {
          type: Number,
          default: 0,
        },

        fastTagPayable: {
          type: Number,
          default: 0,
        },

        pickupCharge: {
          type: Number,
          default: 0,
        },

        dropCharge: {
          type: Number,
          default: 0,
        },

        securityDeposit: {
          type: Number,
          default: 0,
        },

        extraCharges: {
          type: Number,
          default: 0,
        },

        discountAmount: {
          type: Number,
          default: 0,
        },

        totalAmount: {
          type: Number,
          default: 0,
        },

        bookingAmountPaid: {
          type: Number,
          default: 0,
        },

        amountReceivedNow: {
          type: Number,
          default: 0,
        },

        // NEW
        refundedAmount: {
          type: Number,
          default: 0,
        },

        totalCollected: {
          type: Number,
          default: 0,
        },

        balanceAmount: {
          type: Number,
          default: 0,
        },

        // NEW
        refundDue: {
          type: Number,
          default: 0,
        },
      },
    },
    extensionBills: [extensionBillSchema],

    notes: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },

    images: {
      customerPhoto: {
        type: String,
        default: "",
      },
      customerProfileImage: {
        type: String,
        default: "",
      },

      customerWithVehicle: {
        type: String,
        default: "",
      },

      idCardFront: {
        type: String,
        default: "",
      },

      idCardBack: {
        type: String,
        default: "",
      },

      drivingLicenseFront: {
        type: String,
        default: "",
      },

      drivingLicenseBack: {
        type: String,
        default: "",
      },
      toolkit: {
        type: String,
        default: "",
      },

      spareTyre: {
        type: String,
        default: "",
      },

      odometer: {
        type: String,
        default: "",
      },

      fuelGauge: {
        type: String,
        default: "",
      },

      interior: {
        type: String,
        default: "",
      },

      roofTop: {
        type: String,
        default: "",
      },

      vehicleFront: {
        type: String,
        default: "",
      },

      vehicleRear: {
        type: String,
        default: "",
      },

      vehicleLeft: {
        type: String,
        default: "",
      },

      vehicleRight: {
        type: String,
        default: "",
      },

      damageImages: {
        type: [String],
        default: [],
      },
    },
    hasUploadedImages: {
      type: Boolean,
      default: false,
    },
    bookingStatus: {
      type: String,
      enum: ["draft", "confirmed", "active", "completed", "cancelled"],
      default: "confirmed",
      index: true,
    },

    handoverStatus: {
      type: String,
      enum: ["active", "returned", "cancelled"],
      default: "active",
    },

    returnDetails: {
      returnedAt: {
        type: Date,
      },

      returnedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },

      remarks: {
        type: String,
        trim: true,
        default: "",
      },

      vehicleCondition: {
        type: String,
        default: "",
      },
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },
    assignedDriver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

handoverSchema.pre("save", function () {
  if (this.payment) {
    const totalAmount = Number(this.payment.totalAmount) || 0;

    const bookingPaid = Number(this.payment.bookingAmountPaid) || 0;

    const receivedNow = Number(this.payment.amountReceivedNow) || 0;

    // CHANGED: refunds reduce what the company actually holds
    const refunded = Number(this.payment.refundedAmount) || 0;

    const totalPaid = bookingPaid + receivedNow - refunded;

    this.payment.balanceAmount = Math.max(0, totalAmount - totalPaid);

    // NEW: overpayment that still has to be returned
    this.payment.refundDue = Math.max(0, totalPaid - totalAmount);

    if (this.payment.balanceAmount === 0) {
      this.payment.paymentStatus = "paid";
    } else if (totalPaid > 0) {
      this.payment.paymentStatus = "partial";
    } else {
      this.payment.paymentStatus = "pending";
    }
  }
});

const Handover = mongoose.model("Handover", handoverSchema);

export default Handover;