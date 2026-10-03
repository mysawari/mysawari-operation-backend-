import mongoose from "mongoose";
import Handover from "../models/handover.model.js";
import Vehicle from "../models/vehicle.model.js";
import { sendBookingConfirmation } from "../services/wati.service.js";
import VehicleReturn from "../models/vehicleReturn.model.js";
import Booking from "../models/booking.model.js";
import PaymentHistory from "../models/paymentHistory.model.js";

const PAGE_SIZE_DEFAULT = 10;
const MAX_PAGE_LIMIT = 30;
//extra function helper
const IST_TZ = "Asia/Kolkata";
// recieved list
function istDayBoundsUTC(yyyyMmDd) {
  const startUTC = new Date(`${yyyyMmDd}T00:00:00+05:30`);
  const endUTC = new Date(startUTC.getTime() + 24 * 60 * 60 * 1000);
  return { startUTC, endUTC };
}
// recieved list helper
async function countNonCompleted(baseMatch, dateFilter) {
  const result = await Handover.aggregate([
    { $match: { ...baseMatch, ...dateFilter } },
    {
      $lookup: {
        from: VehicleReturn.collection.name,
        let: { hid: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$handover", "$$hid"] },
                  { $eq: ["$returnStatus", "completed"] },
                ],
              },
            },
          },
          { $limit: 1 },
        ],
        as: "ret",
      },
    },
    { $match: { ret: { $size: 0 } } },
    { $count: "count" },
  ]);
  return result[0]?.count || 0;
}

/* =========================================================
   HELPERS
========================================================= */

const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfDay = (date) => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

const parseDateParam = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

// ==========================================
// Draft contoller
// ==========================================
export const createDraftHandover = async (req, res) => {
  try {
    const draft = await Handover.create({
      company: req.user.company || req.user._id,
      createdBy: req.user._id,

      bookingStatus: "draft",

      draftProgress: {
        enabled: true,
        currentScreen: "customer",
        customerCompleted: false,
        vehicleCompleted: false,
        tripCompleted: false,
        paymentCompleted: false,
        imagesCompleted: false,
        uploadedImages: 0,
        totalImages: 9,
        lastSavedAt: new Date(),
      },

      customer: {
        fullName: "",
        mobileNumber: "",
        alternateMobileNumber: "",
        occupation: "",
        destination: "",
      },

      identity: {
        aadhaarNumber: "",
        drivingLicenseNumber: "",
      },

      vehicle: {
        vehicleId: null,
        vehicleName: "",
        vehicleNumber: "",
        vehicleColor: "",
        handoverKm: 0,
      },

      trip: {
        tripType: "local",
        numberOfDays: 1,
        pickupDateTime: null,
        dropDateTime: null,
      },

      payment: {
        fuelLevel: 7,
        fastTagBalance: 0,
        fastTagPayableAmount: 0,
        totalFare: 0,
        securityDeposit: 0,
        extraCharges: 0,
        discountAmount: 0,
        totalAmount: 0,
        bookingAmountPaid: 0,
        amountReceivedNow: 0,
        balanceAmount: 0,
        paymentMethod: "cash",
        paymentBreakdown: {
          cash: 0,
          phonePe: 0,
          razorpay: 0,
        },
        paymentStatus: "pending",
      },

      notes: "",

      images: {
        customerPhoto: "",
        customerProfileImage: "",
        customerWithVehicle: "",
        idCardFront: "",
        idCardBack: "",
        vehicleFront: "",
        vehicleRear: "",
        vehicleLeft: "",
        vehicleRight: "",
      },
    });

    return res.status(201).json({
      success: true,
      message: "Draft handover created successfully.",
      data: {
        handoverId: draft._id,
        bookingStatus: draft.bookingStatus,
        draftProgress: draft.draftProgress,
      },
    });
  } catch (error) {
    console.error("Create Draft Error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to create draft.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
export const updateDraftHandover = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid handover id",
      });
    }

    const handover = await Handover.findById(id);

    if (!handover || handover.isDeleted) {
      return res.status(404).json({
        success: false,
        message: "Draft not found",
      });
    }

    const { customer, identity, vehicle, trip, payment, notes, currentScreen } =
      req.body;

    if (customer) {
      handover.customer = {
        ...handover.customer.toObject(),
        ...customer,
      };
    }

    if (identity) {
      handover.identity = {
        ...handover.identity.toObject(),
        ...identity,
      };
    }

    if (vehicle) {
      handover.vehicle = {
        ...handover.vehicle.toObject(),
        ...vehicle,
      };
    }

    if (trip) {
      handover.trip = {
        ...handover.trip.toObject(),
        ...trip,
      };
    }

    if (payment) {
      handover.payment = {
        ...handover.payment.toObject(),
        ...payment,
      };
    }

    if (notes !== undefined) {
      handover.notes = notes;
    }

    if (currentScreen) {
      handover.draftProgress.currentScreen = currentScreen;
    }

    handover.draftProgress.enabled = true;
    handover.draftProgress.lastSavedAt = new Date();

    await handover.save();

    return res.status(200).json({
      success: true,
      message: "Draft auto-saved.",
      data: handover,
    });
  } catch (error) {
    console.error("Update Draft Error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to save draft.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
export const updateDraftImages = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid handover id",
      });
    }

    const handover = await Handover.findById(id);

    if (!handover || handover.isDeleted) {
      return res.status(404).json({
        success: false,
        message: "Draft not found",
      });
    }

    if (!handover.images) {
      handover.images = {};
    }

    const files = req.files || {};

    if (files.customerPhoto?.[0]) {
      handover.images.customerPhoto = files.customerPhoto[0].path;
    }

    if (files.customerProfileImage?.[0]) {
      handover.images.customerProfileImage = files.customerProfileImage[0].path;
    }

    if (files.customerWithVehicle?.[0]) {
      handover.images.customerWithVehicle = files.customerWithVehicle[0].path;
    }

    if (files.idCardFront?.[0]) {
      handover.images.idCardFront = files.idCardFront[0].path;
    }

    if (files.idCardBack?.[0]) {
      handover.images.idCardBack = files.idCardBack[0].path;
    }

    if (files.vehicleFront?.[0]) {
      handover.images.vehicleFront = files.vehicleFront[0].path;
    }

    if (files.vehicleRear?.[0]) {
      handover.images.vehicleRear = files.vehicleRear[0].path;
    }

    if (files.vehicleLeft?.[0]) {
      handover.images.vehicleLeft = files.vehicleLeft[0].path;
    }

    if (files.vehicleRight?.[0]) {
      handover.images.vehicleRight = files.vehicleRight[0].path;
    }

    handover.draftProgress.enabled = true;
    handover.draftProgress.currentScreen = "images";
    handover.draftProgress.lastSavedAt = new Date();

    await handover.save();

    return res.status(200).json({
      success: true,
      message: "Images saved successfully.",
      data: {
        uploadedImages: handover.draftProgress.uploadedImages,
        totalImages: handover.draftProgress.totalImages,
        imagesCompleted: handover.draftProgress.imagesCompleted,
      },
    });
  } catch (error) {
    console.error("Upload Draft Images Error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to upload images.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
export const getLatestDraftHandover = async (req, res) => {
  try {
    const draft = await Handover.findOne({
      bookingStatus: "draft",
      isDeleted: false,
    })
      .populate("vehicle.vehicleId", "vehicleName vehicleNumber")
      .sort({ updatedAt: -1 })
      .lean();

    if (!draft) {
      return res.status(200).json({
        success: true,
        data: null,
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        _id: draft._id,

        customer: draft.customer,

        vehicle: draft.vehicle,

        trip: draft.trip,

        payment: draft.payment,

        images: draft.images,

        draftProgress: draft.draftProgress,

        bookingStatus: draft.bookingStatus,

        updatedAt: draft.updatedAt,
      },
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch latest draft.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
export const getHandoverById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid handover id",
      });
    }

    const handover = await Handover.findById(id)
      .populate("createdBy", "fullName email mobileNumber role")
      .populate("vehicle.vehicleId")
      .populate("extensionBills.createdBy", "fullName email")
      .lean();

    if (!handover || handover.isDeleted) {
      return res.status(404).json({
        success: false,
        message: "Handover not found",
      });
    }

    const payment = handover.payment || {};
    const billSummary = payment.billSummary || {};

    const extensionBills = [...(handover.extensionBills || [])].sort(
      (a, b) => a.billNumber - b.billNumber,
    );

    const totalExtensionAmount = extensionBills.reduce(
      (sum, bill) => sum + (bill.extensionAmount || 0),
      0,
    );

    const totalExtensionCollected = extensionBills.reduce(
      (sum, bill) => sum + (bill.amountCollected || 0),
      0,
    );

    const extensionHistory = extensionBills.map((bill) => ({
      _id: bill._id,

      billNumber: bill.billNumber,

      previousDropDateTime: bill.previousDropDateTime,
      newDropDateTime: bill.newDropDateTime,

      previousNumberOfDays: bill.previousNumberOfDays,
      newNumberOfDays: bill.newNumberOfDays,

      extraDays: bill.extraDays,

      extensionAmount: bill.extensionAmount,

      amountCollected: bill.amountCollected,

      remainingAmount: Math.max(
        (bill.extensionAmount || 0) - (bill.amountCollected || 0),
        0,
      ),

      totalFareAfterThisBill: bill.totalFareAfterThisBill,

      reason: bill.reason,

      createdBy: bill.createdBy,

      createdAt: bill.createdAt,
    }));

    const latestExtension =
      extensionHistory.length > 0
        ? extensionHistory[extensionHistory.length - 1]
        : null;

    handover.payment.billSummary = {
      ...billSummary,

      extensionSummary: {
        totalExtensions: extensionHistory.length,

        totalExtensionAmount,

        totalExtensionCollected,

        totalOutstanding: Math.max(
          totalExtensionAmount - totalExtensionCollected,
          0,
        ),

        latestExtension,

        history: extensionHistory,
      },
    };

    return res.status(200).json({
      success: true,
      data: handover,
    });
  } catch (error) {
    console.error("GET HANDOVER BY ID ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch handover.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
export const completeDraftHandover = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid handover id",
      });
    }

    const handover = await Handover.findById(id);

    if (!handover || handover.isDeleted) {
      return res.status(404).json({
        success: false,
        message: "Draft not found",
      });
    }

    if (!handover.draftProgress.customerCompleted) {
      return res.status(400).json({
        success: false,
        message: "Customer details are incomplete.",
      });
    }

    if (!handover.draftProgress.vehicleCompleted) {
      return res.status(400).json({
        success: false,
        message: "Vehicle details are incomplete.",
      });
    }

    if (!handover.draftProgress.tripCompleted) {
      return res.status(400).json({
        success: false,
        message: "Trip details are incomplete.",
      });
    }

    if (!handover.draftProgress.paymentCompleted) {
      return res.status(400).json({
        success: false,
        message: "Payment details are incomplete.",
      });
    }

    if (!handover.draftProgress.imagesCompleted) {
      return res.status(400).json({
        success: false,
        message: `Please upload all images (${handover.draftProgress.uploadedImages}/${handover.draftProgress.totalImages}).`,
      });
    }

    const vehicle = await Vehicle.findById(handover.vehicle.vehicleId);

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: "Vehicle not found.",
      });
    }

    if (vehicle.status !== "available") {
      return res.status(400).json({
        success: false,
        message: "Vehicle is not available.",
      });
    }

    vehicle.status = "rent";

    if (handover.vehicle.handoverKm) {
      vehicle.currentKm = handover.vehicle.handoverKm;
    }

    await vehicle.save();

    handover.bookingStatus = "confirmed";

    handover.draftProgress.enabled = false;

    handover.draftProgress.currentScreen = "completed";

    await handover.save();

    try {
      await sendBookingConfirmation({
        customer: handover.customer,
        vehicle: handover.vehicle,
        trip: handover.trip,
        payment: handover.payment,
      });
    } catch (err) {
      console.log("WhatsApp Error:", err.message);
    }

    return res.status(200).json({
      success: true,
      message: "Handover completed successfully.",
      data: handover,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Unable to complete handover.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
// ==========================================
// CREATE HANDOVER
// ==========================================
export const createHandover = async (req, res, next) => {
  try {
    const {
      bookingId,
      customer,
      identity,
      vehicle,
      trip,
      payment,
      notes,
      bookingStatus,
    } = req.body;

    const files = req.files || {};

    // ==========================
    // VALIDATIONS
    // ==========================
    if (!customer?.fullName || !customer?.mobileNumber) {
      return res.status(400).json({
        success: false,
        message: "Customer details are required",
      });
    }

    if (!identity?.aadhaarNumber || !identity?.drivingLicenseNumber) {
      return res.status(400).json({
        success: false,
        message: "Aadhaar and Driving License are required",
      });
    }

    if (!vehicle?.vehicleId) {
      return res.status(400).json({
        success: false,
        message: "Vehicle selection is required",
      });
    }

    if (!trip?.pickupDateTime || !trip?.dropDateTime) {
      return res.status(400).json({
        success: false,
        message: "Trip dates are required",
      });
    }

    // ==========================
    // NORMALIZE / VALIDATE UPI LAST 4 DIGITS
    // ==========================
    // Accepts an array of 4-digit strings (new multi-entry format).
    // Falls back gracefully if a single string is somehow still sent,
    // so older clients don't break outright.
    const rawUpiLast4 = payment?.upiLast4;
    const upiLast4List = Array.isArray(rawUpiLast4)
      ? rawUpiLast4
      : rawUpiLast4
        ? [rawUpiLast4]
        : [];

    const normalizedUpiLast4 = upiLast4List
      .map((v) => String(v || "").trim())
      .filter((v) => v.length > 0);

    const hasInvalidUpiEntry = normalizedUpiLast4.some(
      (v) => !/^\d{4}$/.test(v),
    );

    if (hasInvalidUpiEntry) {
      return res.status(400).json({
        success: false,
        message: "Each UPI last 4 digits entry must contain exactly 4 numbers",
      });
    }

    // ==========================
    // CHECK VEHICLE
    // ==========================
    const selectedVehicle = await Vehicle.findOne({
      _id: vehicle.vehicleId,
      isDeleted: false,
    });

    if (!selectedVehicle) {
      return res.status(404).json({
        success: false,
        message: "Vehicle not found",
      });
    }

    if (selectedVehicle.status !== "available") {
      return res.status(400).json({
        success: false,
        message: "Selected vehicle is not available",
      });
    }
    if (
      payment?.fuelLevel === undefined ||
      payment.fuelLevel < 0 ||
      payment.fuelLevel > 7
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid fuel level",
      });
    }

    const booking = await Booking.findById(bookingId);

    // ==========================
    // CREATE HANDOVER
    // ==========================
    const handover = await Handover.create({
      company: req.user.company || req.user._id,
      createdBy: req.user._id,
      bookingId,
      customer: {
        fullName: customer.fullName,
        mobileNumber: customer.mobileNumber,
        alternateMobileNumber: customer.alternateMobileNumber || "",
        occupation: customer.occupation || "",
        destination: customer.destination || "",
      },

      identity: {
        aadhaarNumber: identity.aadhaarNumber,
        drivingLicenseNumber: identity.drivingLicenseNumber,
      },

      vehicle: {
        vehicleId: selectedVehicle._id,
        vehicleName: selectedVehicle.vehicleName,
        vehicleNumber: selectedVehicle.vehicleNumber,
        vehicleColor: selectedVehicle.color || "",
        handoverKm: Number(vehicle?.handoverKm) || 0,
        spareAvailable: vehicle?.spareAvailable === true,
        toolkitAvailable: vehicle?.toolkitAvailable === true,
      },

      trip: {
        tripType: trip?.tripType || "local",
        numberOfDays: Number(trip?.numberOfDays) || 1,
        pickupDateTime: trip.pickupDateTime,
        dropDateTime: trip.dropDateTime,
      },

      payment: {
        fuelLevel:
          payment?.fuelLevel !== undefined ? Number(payment.fuelLevel) : 7,

        fastTagBalance: Number(payment?.fastTagBalance) || 0,

        fastTagPayableAmount: Number(payment?.fastTagPayableAmount) || 0,

        totalFare: Number(payment?.totalFare) || 0,

        securityDeposit: Number(payment?.securityDeposit) || 0,

        extraCharges: Number(payment?.extraCharges) || 0,

        discountAmount: Number(payment?.discountAmount) || 0,

        totalAmount: Number(payment?.totalAmount) || 0,

        bookingAmountPaid: Number(payment?.bookingAmountPaid) || 0,

        amountReceivedNow: Number(payment?.amountReceivedNow) || 0,

        balanceAmount: Number(payment?.balanceAmount) || 0,

        paymentMethod: payment?.paymentMethod || "cash",

        upiLast4: normalizedUpiLast4,

        paymentBreakdown: {
          cash: Number(payment?.paymentBreakdown?.cash) || 0,

          phonePe: Number(payment?.paymentBreakdown?.phonePe) || 0,

          razorpay: Number(payment?.paymentBreakdown?.razorpay) || 0,
        },
        billSummary: {
          totalFare: Number(payment?.totalFare) || 0,

          fastTagPayable: Number(payment?.fastTagPayableAmount) || 0,

          pickupCharge: Number(booking?.pickup?.charge) || 0,

          dropCharge: Number(booking?.drop?.charge) || 0,

          securityDeposit: Number(payment?.securityDeposit) || 0,

          extraCharges: Number(payment?.extraCharges) || 0,

          discountAmount: Number(payment?.discountAmount) || 0,

          totalAmount: Number(payment?.totalAmount) || 0,

          bookingAmountPaid: Number(payment?.bookingAmountPaid) || 0,

          amountReceivedNow: Number(payment?.amountReceivedNow) || 0,

          totalCollected:
            Number(payment?.bookingAmountPaid || 0) +
            Number(payment?.amountReceivedNow || 0),

          balanceAmount: Number(payment?.balanceAmount) || 0,
        },
      },

      notes: notes || "",

      bookingStatus: "draft",

      images: {
        customerPhoto: files?.customerPhoto?.[0]?.path || "",

        customerWithVehicle: files?.customerWithVehicle?.[0]?.path || "",

        vehicleFront: files?.vehicleFront?.[0]?.path || "",

        vehicleRear: files?.vehicleRear?.[0]?.path || "",

        vehicleLeft: files?.vehicleLeft?.[0]?.path || "",

        vehicleRight: files?.vehicleRight?.[0]?.path || "",
      },
    });

    // ==========================
    // CREATE PAYMENT HISTORY
    // ==========================
    // Only record money actually received during handover.
    // bookingAmountPaid is NOT recorded here because it may
    // have been collected previously during booking.
    if (Number(payment?.amountReceivedNow) > 0) {
      try {
        await PaymentHistory.create({
          company: req.user.company || req.user._id,

          bookingId,

          handoverId: handover._id,

          customer: {
            fullName: customer.fullName,
            mobileNumber: customer.mobileNumber,
          },

          vehicle: {
            vehicleId: selectedVehicle._id,
            vehicleName: selectedVehicle.vehicleName,
            vehicleNumber: selectedVehicle.vehicleNumber,
          },
          booking: {
            fromDate: trip.pickupDateTime,
            toDate: trip.dropDateTime,
            bookingAmount: Number(payment?.bookingAmountPaid) || 0,
          },

          amount: Number(payment.amountReceivedNow),

          paymentMethod: payment?.paymentMethod || "cash",
          upiLast4: normalizedUpiLast4,

          paymentBreakdown: {
            cash: Number(payment?.paymentBreakdown?.cash) || 0,
            phonePe: Number(payment?.paymentBreakdown?.phonePe) || 0,
            razorpay: Number(payment?.paymentBreakdown?.razorpay) || 0,
          },

          type: "handover",

          note: "Payment received during vehicle handover",

          createdBy: req.user._id,
        });
        await Vehicle.findByIdAndUpdate(selectedVehicle._id, {
          $addToSet: {
            payments: paymentHistory._id,
          },
        });
      } catch (paymentHistoryError) {
        // Do NOT break the handover flow if payment history fails.
        console.error(
          "Payment History Creation Error:",
          paymentHistoryError?.message || paymentHistoryError,
        );
      }
    }

    // ==========================
    // UPDATE VEHICLE STATUS
    // ==========================
    selectedVehicle.status = "rent";

    if (vehicle?.handoverKm) {
      selectedVehicle.currentKm = Number(vehicle.handoverKm);
    }

    await selectedVehicle.save();
    await Booking.findByIdAndUpdate(bookingId, {
      handover: handover._id,
      status: "vehicle_handover",
    });
    // ==========================
    // SEND WHATSAPP BOOKING MESSAGE
    // ==========================
    try {
      const result = await sendBookingConfirmation({
        customer: handover.customer,
        vehicle: handover.vehicle,
        trip: handover.trip,
        payment: handover.payment,
      });

      console.log("WATI RESPONSE:", result);
    } catch (whatsappError) {
      console.error(
        "WhatsApp Error:",
        whatsappError?.response?.data || whatsappError?.message,
      );

      // Booking should still be created
    }

    // ==========================
    // SUCCESS RESPONSE
    // ==========================
    return res.status(201).json({
      success: true,
      message: "Handover created successfully",
      data: handover,
    });
  } catch (error) {
    console.error("Create Handover Error:", error);

    next(error);
  }
};

export const uploadHandoverImages = async (req, res, next) => {
  try {
    console.log("FILES RECEIVED:", req.files);

    const { handoverId } = req.params;

    if (!handoverId) {
      return res.status(400).json({
        success: false,
        message: "Handover ID is required",
      });
    }

    const handover = await Handover.findById(handoverId);

    if (!handover) {
      return res.status(404).json({
        success: false,
        message: "Handover not found",
      });
    }

    // Ensure images object exists
    if (!handover.images) {
      handover.images = {};
    }

    // Customer Images
    if (req.files?.customerPhoto?.[0]) {
      handover.images.customerPhoto = req.files.customerPhoto[0].path;
    }
    if (req.files?.customerProfileImage?.[0]) {
      handover.images.customerProfileImage =
        req.files.customerProfileImage[0].path;
    }

    if (req.files?.customerWithVehicle?.[0]) {
      handover.images.customerWithVehicle =
        req.files.customerWithVehicle[0].path;
    }

    // ID Card Images
    if (req.files?.idCardFront?.[0]) {
      handover.images.idCardFront = req.files.idCardFront[0].path;
    }

    if (req.files?.idCardBack?.[0]) {
      handover.images.idCardBack = req.files.idCardBack[0].path;
    }

    // Vehicle Images
    if (req.files?.vehicleFront?.[0]) {
      handover.images.vehicleFront = req.files.vehicleFront[0].path;
    }

    if (req.files?.vehicleRear?.[0]) {
      handover.images.vehicleRear = req.files.vehicleRear[0].path;
    }

    if (req.files?.vehicleLeft?.[0]) {
      handover.images.vehicleLeft = req.files.vehicleLeft[0].path;
    }

    if (req.files?.vehicleRight?.[0]) {
      handover.images.vehicleRight = req.files.vehicleRight[0].path;
    }

    await handover.save();

    return res.status(200).json({
      success: true,
      message: "Handover images uploaded successfully",
      data: handover,
    });
  } catch (error) {
    console.error("UPLOAD ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to upload handover images",
    });
  }
};
//new
export const uploadSingleImage = async (req, res) => {
  console.log(req.file);
  console.log(req.body);
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Image is required",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Image uploaded successfully",
      data: {
        url: req.file.path,
      },
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Image upload failed",
    });
  }
};
// version 1.0
export const saveHandoverImage = async (req, res) => {
  try {
    const { handoverId } = req.params;

    if (!handoverId) {
      return res.status(400).json({
        success: false,
        message: "Handover ID is required",
      });
    }

    const {
      customerPhoto,
      customerProfileImage,
      customerWithVehicle,
      idCardFront,
      idCardBack,
      vehicleFront,
      vehicleRear,
      vehicleLeft,
      vehicleRight,
    } = req.body;

    const update = {};

    if (customerPhoto) update["images.customerPhoto"] = customerPhoto;
    if (customerProfileImage)
      update["images.customerProfileImage"] = customerProfileImage;
    if (customerWithVehicle)
      update["images.customerWithVehicle"] = customerWithVehicle;
    if (idCardFront) update["images.idCardFront"] = idCardFront;
    if (idCardBack) update["images.idCardBack"] = idCardBack;
    if (vehicleFront) update["images.vehicleFront"] = vehicleFront;
    if (vehicleRear) update["images.vehicleRear"] = vehicleRear;
    if (vehicleLeft) update["images.vehicleLeft"] = vehicleLeft;
    if (vehicleRight) update["images.vehicleRight"] = vehicleRight;

    const handover = await Handover.findByIdAndUpdate(
      handoverId,
      {
        $set: update,
      },
      {
        new: true,
        runValidators: true,
      },
    );

    if (!handover) {
      return res.status(404).json({
        success: false,
        message: "Handover not found",
      });
    }

    const images = handover.images || {};

    const allImagesUploaded = [
      images.customerPhoto,
      images.customerProfileImage,
      images.customerWithVehicle,
      images.idCardFront,
      images.idCardBack,
      images.vehicleFront,
      images.vehicleRear,
      images.vehicleLeft,
      images.vehicleRight,
    ].every((img) => typeof img === "string" && img.trim() !== "");

    handover.hasUploadedImages = allImagesUploaded;

    if (!allImagesUploaded) {
      handover.bookingStatus = "draft";
    }

    await handover.save();

    return res.status(200).json({
      success: true,
      message: "Images saved successfully",
      data: {
        _id: handover._id,
        bookingStatus: handover.bookingStatus,
        hasUploadedImages: handover.hasUploadedImages,
        images: handover.images,
      },
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Failed to save images",
    });
  }
};
// version 1.1
export const saveHandoverImages = async (req, res) => {
  try {
    const { handoverId } = req.params;

    if (!handoverId) {
      return res.status(400).json({
        success: false,
        message: "Handover ID is required",
      });
    }

    // These MUST be present for the handover to be considered complete
    const REQUIRED_IMAGES = [
      "customerPhoto",
      "customerProfileImage",
      "customerWithVehicle",
      "idCardFront",
      "idCardBack",
      "vehicleFront",
      "vehicleRear",
      "vehicleLeft",
      "vehicleRight",
    ];

    // Saved if provided, but don't affect completion/progress calculation
    const OPTIONAL_IMAGES = [
      "drivingLicenseFront",
      "drivingLicenseBack",
      "toolkit",
      "spareTyre",
      "odometer",
      "fuelGauge",
      "interior",
      "roofTop",
    ];

    const update = {};

    REQUIRED_IMAGES.forEach((key) => {
      const value = req.body[key];
      if (typeof value === "string" && value.trim() !== "") {
        update[`images.${key}`] = value.trim();
      }
    });

    OPTIONAL_IMAGES.forEach((key) => {
      const value = req.body[key];
      if (typeof value === "string" && value.trim() !== "") {
        update[`images.${key}`] = value.trim();
      }
    });

    // Optional close-up damage photos (array of Cloudinary URLs)
    let damageImages = req.body.damageImages;

    if (typeof damageImages === "string") {
      try {
        damageImages = JSON.parse(damageImages);
      } catch {
        damageImages = damageImages ? [damageImages] : [];
      }
    }

    if (Array.isArray(damageImages)) {
      update["images.damageImages"] = damageImages
        .filter((url) => typeof url === "string" && url.trim() !== "")
        .map((url) => url.trim());
    }

    const handover = await Handover.findByIdAndUpdate(
      handoverId,
      {
        $set: update,
      },
      {
        new: true,
        runValidators: true,
      },
    );

    if (!handover) {
      return res.status(404).json({
        success: false,
        message: "Handover not found",
      });
    }

    const images = handover.images || {};

    const uploadedCount = REQUIRED_IMAGES.filter((key) => {
      const value = images[key];
      return typeof value === "string" && value.trim() !== "";
    }).length;

    const totalRequired = REQUIRED_IMAGES.length;

    const allImagesUploaded = uploadedCount === totalRequired;

    const progress = Math.round((uploadedCount / totalRequired) * 100);

    handover.hasUploadedImages = allImagesUploaded;

    // Keep booking as draft until every required image is uploaded
    if (allImagesUploaded) {
      handover.bookingStatus = "confirmed";
    } else {
      handover.bookingStatus = "draft";
    }

    await handover.save();

    return res.status(200).json({
      success: true,
      message: allImagesUploaded
        ? "All images uploaded successfully."
        : "Images saved successfully. Draft updated.",

      data: {
        _id: handover._id,

        bookingStatus: handover.bookingStatus,

        hasUploadedImages: handover.hasUploadedImages,

        uploadedCount,

        totalRequired,

        progress,

        remainingImages: REQUIRED_IMAGES.filter((key) => {
          const value = images[key];

          return !(typeof value === "string" && value.trim() !== "");
        }),

        images: handover.images,
      },
    });
  } catch (error) {
    console.error("Save Handover Images Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to save images",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
//immediate save image
export const saveSingleHandoverImage = async (req, res) => {
  try {
    const { handoverId } = req.params;
    const { key, url } = req.body;

    if (!handoverId) {
      return res.status(400).json({
        success: false,
        message: "Handover ID is required",
      });
    }

    if (!key) {
      return res.status(400).json({
        success: false,
        message: "Image key is required",
      });
    }

    if (!url || typeof url !== "string" || url.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Image URL is required",
      });
    }

    const ALLOWED_IMAGES = [
      "customerPhoto",
      "customerProfileImage",
      "customerWithVehicle",
      "idCardFront",
      "idCardBack",
      "vehicleFront",
      "vehicleRear",
      "vehicleLeft",
      "vehicleRight",

      // Optional
      "drivingLicenseFront",
      "drivingLicenseBack",
      "toolkit",
      "spareTyre",
      "odometer",
      "fuelGauge",
      "interior",
      "roofTop",
    ];

    if (!ALLOWED_IMAGES.includes(key)) {
      return res.status(400).json({
        success: false,
        message: `Invalid image key: ${key}`,
      });
    }

    const REQUIRED_IMAGES = [
      "customerPhoto",
      "customerProfileImage",
      "customerWithVehicle",
      "idCardFront",
      "idCardBack",
      "vehicleFront",
      "vehicleRear",
      "vehicleLeft",
      "vehicleRight",
    ];

    const handover = await Handover.findById(handoverId);

    if (!handover) {
      return res.status(404).json({
        success: false,
        message: "Handover not found",
      });
    }

    // Immediately save this single image
    handover.images = handover.images || {};
    handover.images[key] = url.trim();

    // Recalculate required image progress
    const uploadedCount = REQUIRED_IMAGES.filter((imageKey) => {
      const value = handover.images[imageKey];

      return typeof value === "string" && value.trim() !== "";
    }).length;

    const totalRequired = REQUIRED_IMAGES.length;

    const allImagesUploaded = uploadedCount === totalRequired;

    const progress = Math.round((uploadedCount / totalRequired) * 100);

    // Keep your existing flow
    handover.hasUploadedImages = allImagesUploaded;

    if (allImagesUploaded) {
      handover.bookingStatus = "confirmed";
    } else {
      handover.bookingStatus = "draft";
    }

    await handover.save();

    return res.status(200).json({
      success: true,
      message: "Image saved successfully",
      data: {
        _id: handover._id,
        key,
        url: handover.images[key],
        bookingStatus: handover.bookingStatus,
        hasUploadedImages: handover.hasUploadedImages,
        uploadedCount,
        totalRequired,
        progress,
        remainingImages: REQUIRED_IMAGES.filter((imageKey) => {
          const value = handover.images[imageKey];

          return !(typeof value === "string" && value.trim() !== "");
        }),
      },
    });
  } catch (error) {
    console.error("Save Single Handover Image Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to save image",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
export const getHandoverImages = async (req, res) => {
  try {
    const { handoverId } = req.params;

    if (!handoverId) {
      return res.status(400).json({
        success: false,
        message: "Handover ID is required",
      });
    }

    const handover = await Handover.findById(handoverId).select(
      "images bookingStatus hasUploadedImages",
    );

    if (!handover) {
      return res.status(404).json({
        success: false,
        message: "Handover not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Handover images fetched successfully",
      data: {
        images: handover.images || {},
        bookingStatus: handover.bookingStatus,
        hasUploadedImages: handover.hasUploadedImages,
      },
    });
  } catch (error) {
    console.error("Get Handover Images Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch handover images",
    });
  }
};
// active rental screen new
export const getActiveHandover = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      MAX_PAGE_LIMIT,
      Math.max(1, parseInt(req.query.limit, 10) || PAGE_SIZE_DEFAULT),
    );
    const skip = (page - 1) * limit;

    const tab = ["today", "yesterday", "all"].includes(req.query.tab)
      ? req.query.tab
      : "all";

    const search = String(req.query.search || "").trim();

    // Custom date range (from the filter modal) always wins over the
    // today/yesterday/all tab logic when present.
    const rangeFrom = parseDateParam(req.query.from);
    const rangeTo = parseDateParam(req.query.to);

    const match = {
      handoverStatus: "active",
      isDeleted: false,
    };

    if (rangeFrom || rangeTo) {
      match["trip.pickupDateTime"] = {};
      if (rangeFrom) match["trip.pickupDateTime"].$gte = rangeFrom;
      if (rangeTo) match["trip.pickupDateTime"].$lte = rangeTo;
    } else if (tab === "today") {
      const now = new Date();
      match["trip.pickupDateTime"] = {
        $gte: startOfDay(now),
        $lte: endOfDay(now),
      };
    } else if (tab === "yesterday") {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      match["trip.pickupDateTime"] = {
        $gte: startOfDay(y),
        $lte: endOfDay(y),
      };
    }
    // tab === "all" with no custom range -> no date filter

    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      match.$or = [
        { "customer.fullName": regex },
        { "customer.mobileNumber": regex },
        { "vehicle.vehicleName": regex },
        { "vehicle.vehicleNumber": regex },
      ];
    }

    // Only the fields the list screen actually renders. No populate —
    // formatRentalItem on the client never reads the populated
    // vehicle.vehicleId or createdBy fields, so joining them was pure
    // wasted query cost.
    const projection = {
      "customer.fullName": 1,
      "customer.mobileNumber": 1,
      "vehicle.vehicleName": 1,
      "vehicle.vehicleNumber": 1,
      "trip.pickupDateTime": 1,
      "trip.dropDateTime": 1,
      "payment.billSummary.balanceAmount": 1,
      "payment.balanceAmount": 1,
      "images.vehicleFront": 1,
      createdAt: 1,
    };

    const [data, total] = await Promise.all([
      Handover.find(match, projection)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Handover.countDocuments(match),
    ]);

    return res.status(200).json({
      success: true,
      data,
      page,
      limit,
      total,
      hasMore: skip + data.length < total,
      tab,
    });
  } catch (error) {
    console.log("ACTIVE HANDOVER ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch active handovers",
    });
  }
};
//old
export const getActiveHandovers = async (req, res) => {
  try {
    const activeHandovers = await Handover.find({
      handoverStatus: "active",
      isDeleted: false,
    })
      // Only pull the fields the app actually renders instead of full
      // vehicle/user documents — smaller payload, faster to serialize.
      .populate("vehicle.vehicleId", "vehicleName vehicleNumber")
      .populate("createdBy", "fullName")
      .populate("bookingId", "bookingCode")
      // .lean() skips hydrating full Mongoose documents (getters, virtuals,
      // change tracking) since this is a read-only list response — this
      // alone is typically the single biggest speedup for a GET-list route.
      .select(
        "customer vehicle trip payment images handoverStatus isDeleted createdAt bookingId",
      )
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: activeHandovers.length,
      data: activeHandovers,
    });
  } catch (error) {
    console.log("ACTIVE HANDOVER ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch active handovers",
    });
  }
};

export const getSingleHandover = async (req, res) => {
  try {
    const { id } = req.params;

    // .lean() returns plain JS objects instead of full Mongoose documents —
    // skips getters/virtuals/change-tracking overhead. Read-only detail view,
    // so this is a safe, pure speed win and does NOT change the response
    // shape, so the other screen consuming this same endpoint is unaffected.
    const handover = await Handover.findOne({
      _id: id,
      isDeleted: false,
    })
      .populate("createdBy", "fullName email mobileNumber role")
      .populate("vehicle.vehicleId")
      .populate("bookingId", "bookingCode")
      .populate("returnDetails.returnedBy", "fullName email mobileNumber role")
      .populate("extensionBills.createdBy", "fullName email mobileNumber role")
      // NEW: who performed each vehicle swap, so the exchange history can
      // show a name instead of just an id.
      .populate("vehicleHistory.changedBy", "fullName email mobileNumber role")
      .lean();

    if (!handover) {
      return res.status(404).json({
        success: false,
        message: "Handover not found",
      });
    }

    const vehicleReturn = await VehicleReturn.findOne({
      handover: handover._id,
    })
      .populate("receivedBy", "fullName email mobileNumber role")
      .lean();

    let lastLocation = null;
    if (handover.customer?.mobileNumber) {
      try {
        const Customer = (await import("../models/customer.model.js")).default;
        const customerDoc = await Customer.findOne({
          mobileNumber: handover.customer.mobileNumber,
        }).lean();
        if (customerDoc && customerDoc.lastLocation) {
          lastLocation = customerDoc.lastLocation;
        }
      } catch (e) {
        console.error(
          "Error fetching customer location in getSingleHandover:",
          e,
        );
      }
    }

    // With .lean(), `handover` is already a plain object — no .toObject()
    // needed (and calling it on a lean object would throw).
    const data = { ...handover, customerLocation: lastLocation };

    // FIX: build the bill the frontend renders straight from the stored
    // payment.billSummary — the single already-computed, already-saved
    // breakdown — instead of the frontend re-deriving a "Financial Ledger"
    // from loose top-level payment fields. Falls back to the flat payment
    // fields only for older documents saved before billSummary existed, so
    // nothing on old handovers breaks.
    const rawPayment = data.payment || {};
    const bill = rawPayment.billSummary || {};

    data.payment = {
      ...rawPayment,
      billSummary: {
        totalFare: bill.totalFare ?? rawPayment.totalFare ?? 0,
        fastTagPayable:
          bill.fastTagPayable ?? rawPayment.fastTagPayableAmount ?? 0,
        pickupCharge: bill.pickupCharge ?? 0,
        dropCharge: bill.dropCharge ?? 0,
        securityDeposit:
          bill.securityDeposit ?? rawPayment.securityDeposit ?? 0,
        extraCharges: bill.extraCharges ?? rawPayment.extraCharges ?? 0,
        discountAmount: bill.discountAmount ?? rawPayment.discountAmount ?? 0,
        totalAmount: bill.totalAmount ?? rawPayment.totalAmount ?? 0,
        bookingAmountPaid:
          bill.bookingAmountPaid ?? rawPayment.bookingAmountPaid ?? 0,
        amountReceivedNow:
          bill.amountReceivedNow ?? rawPayment.amountReceivedNow ?? 0,
        totalCollected:
          bill.totalCollected ??
          (rawPayment.bookingAmountPaid || 0) +
            (rawPayment.amountReceivedNow || 0),
        balanceAmount: bill.balanceAmount ?? rawPayment.balanceAmount ?? 0,
      },
    };

    // shape extensionBills for the client — newest first, with the
    // populated creator trimmed down to just what the UI needs, and a
    // rollup summary so the screen doesn't have to reduce() on its own.
    const extensionBills = (handover.extensionBills || [])
      .map((extBill) => ({
        _id: extBill._id,
        billNumber: extBill.billNumber,
        previousDropDateTime: extBill.previousDropDateTime,
        newDropDateTime: extBill.newDropDateTime,
        previousNumberOfDays: extBill.previousNumberOfDays,
        newNumberOfDays: extBill.newNumberOfDays,
        extraDays: extBill.extraDays,
        extensionAmount: extBill.extensionAmount || 0,
        amountCollected: extBill.amountCollected || 0,
        totalFareAfterThisBill: extBill.totalFareAfterThisBill || 0,
        reason: extBill.reason || "",
        createdBy: extBill.createdBy
          ? {
              _id: extBill.createdBy._id,
              fullName: extBill.createdBy.fullName,
              role: extBill.createdBy.role,
            }
          : null,
        createdAt: extBill.createdAt,
      }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    data.extensionBills = extensionBills;

    data.extensionSummary = {
      totalExtensions: extensionBills.length,
      totalExtensionAmount: extensionBills.reduce(
        (sum, b) => sum + (b.extensionAmount || 0),
        0,
      ),
      totalAmountCollected: extensionBills.reduce(
        (sum, b) => sum + (b.amountCollected || 0),
        0,
      ),
      totalExtraDays: extensionBills.reduce(
        (sum, b) => sum + (b.extraDays || 0),
        0,
      ),
    };

    // ── GALLERY ──────────────────────────────────────────────────────────
    // Every single image field that actually exists on the Handover model's
    // `images` subdocument. Previously this list only had 9 of the ~17
    // fields — drivingLicenseFront/Back, toolkit, spareTyre, odometer,
    // fuelGauge, interior and roofTop were being silently dropped.
    const img = handover.images || {};

    data.gallery = {
      handover: [
        { label: "Customer Photo", image: img.customerPhoto || "" },
        { label: "Customer Profile", image: img.customerProfileImage || "" },
        {
          label: "Customer With Vehicle",
          image: img.customerWithVehicle || "",
        },
        { label: "ID Card Front", image: img.idCardFront || "" },
        { label: "ID Card Back", image: img.idCardBack || "" },
        {
          label: "Driving License Front",
          image: img.drivingLicenseFront || "",
        },
        { label: "Driving License Back", image: img.drivingLicenseBack || "" },
        { label: "Toolkit", image: img.toolkit || "" },
        { label: "Spare Tyre", image: img.spareTyre || "" },
        { label: "Odometer", image: img.odometer || "" },
        { label: "Fuel Gauge", image: img.fuelGauge || "" },
        { label: "Interior", image: img.interior || "" },
        { label: "Roof Top", image: img.roofTop || "" },
        { label: "Vehicle Front", image: img.vehicleFront || "" },
        { label: "Vehicle Rear", image: img.vehicleRear || "" },
        { label: "Vehicle Left", image: img.vehicleLeft || "" },
        { label: "Vehicle Right", image: img.vehicleRight || "" },
      ].filter((item) => item.image),
    };

    // NEW: damage photographed AT HANDOVER TIME (pre-existing damage noted
    // before the customer took the vehicle out) — a completely separate
    // thing from VehicleReturn.damageImages (damage noted when it came
    // back). `images.damageImages` on the Handover model was never exposed
    // before.
    data.gallery.handoverDamageImages = (img.damageImages || [])
      .filter(Boolean)
      .map((image, index) => ({
        label: `Pre-existing Damage ${index + 1}`,
        image,
      }));

    // NEW: vehicle swap/exchange history. Each entry already carries its own
    // exchangeImages (front/rear/left/right/additional) taken when the
    // replacement vehicle was handed over — none of this was surfaced
    // before.
    data.gallery.vehicleExchanges = (handover.vehicleHistory || []).map(
      (entry, index) => {
        const ex = entry.exchangeImages || {};
        return {
          index,
          changedAt: entry.changedAt,
          reason: entry.reason || "",
          changedBy: entry.changedBy
            ? {
                _id: entry.changedBy._id,
                fullName: entry.changedBy.fullName,
                role: entry.changedBy.role,
              }
            : null,
          oldVehicle: {
            vehicleName: entry.oldVehicle?.vehicleName || "",
            vehicleNumber: entry.oldVehicle?.vehicleNumber || "",
          },
          newVehicle: {
            vehicleName: entry.newVehicle?.vehicleName || "",
            vehicleNumber: entry.newVehicle?.vehicleNumber || "",
          },
          images: [
            { label: "Front", image: ex.vehicleFront || "" },
            { label: "Rear", image: ex.vehicleRear || "" },
            { label: "Left", image: ex.vehicleLeft || "" },
            { label: "Right", image: ex.vehicleRight || "" },
            { label: "Additional", image: ex.additional || "" },
          ].filter((item) => item.image),
        };
      },
    );

    if (vehicleReturn) {
      data.vehicleReturn = {
        _id: vehicleReturn._id,

        receivedBy: vehicleReturn.receivedBy
          ? {
              _id: vehicleReturn.receivedBy._id,
              fullName: vehicleReturn.receivedBy.fullName,
              role: vehicleReturn.receivedBy.role,
              email: vehicleReturn.receivedBy.email,
              mobileNumber: vehicleReturn.receivedBy.mobileNumber,
            }
          : null,

        receivingTime: vehicleReturn.receivingTime,
        scheduledReturnTime: vehicleReturn.scheduledReturnTime,

        timeStatus: vehicleReturn.timeStatus,
        delayInMinutes: vehicleReturn.delayInMinutes || 0,
        delayText: vehicleReturn.delayText || "0 minutes",

        fuelLevel: vehicleReturn.fuelLevel,
        kilometersAtReturn: vehicleReturn.kilometersAtReturn,

        hasDamage: vehicleReturn.hasDamage,
        damageNotes: vehicleReturn.damageNotes,

        inspection: vehicleReturn.inspection || [],

        settlementDetails: vehicleReturn.settlementDetails || {},

        damageCostDetails: vehicleReturn.damageCostDetails || null,

        returnStatus: vehicleReturn.returnStatus || "completed",

        images: {
          vehicleFront: vehicleReturn.images?.vehicleFront || "",
          vehicleRear: vehicleReturn.images?.vehicleRear || "",
          vehicleLeft: vehicleReturn.images?.vehicleLeft || "",
          vehicleRight: vehicleReturn.images?.vehicleRight || "",
        },

        damageImages: vehicleReturn.damageImages || [],

        createdAt: vehicleReturn.createdAt,
      };

      data.gallery.returnImages = [
        {
          label: "Return Front",
          image: vehicleReturn.images?.vehicleFront || "",
        },
        {
          label: "Return Rear",
          image: vehicleReturn.images?.vehicleRear || "",
        },
        {
          label: "Return Left",
          image: vehicleReturn.images?.vehicleLeft || "",
        },
        {
          label: "Return Right",
          image: vehicleReturn.images?.vehicleRight || "",
        },
      ].filter((item) => item.image);

      // Renamed label to "Return Damage" (was just "Damage") now that the
      // handover-time damage gallery exists too, so the two aren't confused.
      data.gallery.damageImages = (vehicleReturn.damageImages || [])
        .filter(Boolean)
        .map((image, index) => ({
          label: `Return Damage ${index + 1}`,
          image,
        }));
    } else {
      data.vehicleReturn = null;
      data.gallery.returnImages = [];
      data.gallery.damageImages = [];
    }

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("GET SINGLE HANDOVER ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch handover",
    });
  }
};

const SEARCH_LOOKUP_LIMIT = 500;

// "as01ab" -> /a[\s-]*s[\s-]*0[\s-]*1.../ so plates match with or
// without spaces / hyphens.
const loosePlatePattern = (value) =>
  value.replace(/[\s-]/g, "").split("").map(escapeRegex).join("[\\s-]*");

/**
 * Builds a Mongo filter for Handover documents matching the search term.
 * Returns null when there is no search.
 */
const buildHandoverSearchFilter = async (searchTerm) => {
  if (!searchTerm) return null;

  const textRx = new RegExp(escapeRegex(searchTerm), "i");
  const plateSource = loosePlatePattern(searchTerm);
  const plateRx = plateSource ? new RegExp(plateSource, "i") : textRx;

  // "+91 98765-43210" -> "919876543210" so formatted numbers still match
  const digits = searchTerm.replace(/\D/g, "");
  const phoneRx =
    digits.length >= 3 && digits !== searchTerm
      ? new RegExp(escapeRegex(digits))
      : null;

  // Vehicle + booking lookups run in parallel and return only _ids.
  const [vehicles, bookings] = await Promise.all([
    Vehicle.find({
      $or: [{ vehicleName: textRx }, { vehicleNumber: plateRx }],
    })
      .select("_id")
      .limit(SEARCH_LOOKUP_LIMIT)
      .lean(),
    // Drop location: only for 3+ characters, to keep short searches fast
    searchTerm.length >= 3
      ? Booking.find({ "drop.location": textRx })
          .select("_id")
          .sort({ _id: -1 })
          .limit(SEARCH_LOOKUP_LIMIT)
          .lean()
      : Promise.resolve([]),
  ]);

  const or = [
    { "customer.fullName": textRx },
    { "customer.mobileNumber": textRx },
    { "vehicle.vehicleName": textRx },
    { "vehicle.vehicleNumber": plateRx },
  ];

  if (phoneRx) or.push({ "customer.mobileNumber": phoneRx });

  if (vehicles.length) {
    or.push({ "vehicle.vehicleId": { $in: vehicles.map((v) => v._id) } });
  }

  if (bookings.length) {
    or.push({ bookingId: { $in: bookings.map((b) => b._id) } });
  }

  // Booking ID shown on the card = last 8 chars of the handover _id
  if (/^[a-f0-9]{4,8}$/i.test(searchTerm)) {
    or.push({
      $expr: {
        $regexMatch: {
          input: { $substrCP: [{ $toString: "$_id" }, 16, 8] },
          regex: escapeRegex(searchTerm),
          options: "i",
        },
      },
    });
  }

  return { $or: or };
};

export const getReceiveCarList = async (req, res) => {
  try {
    const {
      tab = "today",
      page = 1,
      limit = 7,
      search = "",
      completedDays = 90,
      includeCounts = "true",
    } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 7, 1), 50);
    const searchTerm = String(search || "")
      .trim()
      .toLowerCase()
      .slice(0, 60);

    const baseMatch = {
      isDeleted: false,
      "vehicle.vehicleId": { $exists: true },
      handoverStatus: { $ne: "cancelled" },
    };

    // ---- IST day boundaries, computed once per request ----
    const now = new Date();
    const todayStr = now.toLocaleDateString("en-CA", { timeZone: IST_TZ });
    const tomorrowD = new Date(now);
    tomorrowD.setDate(tomorrowD.getDate() + 1);
    const tomorrowStr = tomorrowD.toLocaleDateString("en-CA", {
      timeZone: IST_TZ,
    });

    const today = istDayBoundsUTC(todayStr);
    const tomorrow = istDayBoundsUTC(tomorrowStr);

    const completedSince = new Date();
    completedSince.setDate(completedSince.getDate() - Number(completedDays));

    let dateFilter = {};
    if (tab === "today") {
      dateFilter = {
        "trip.dropDateTime": { $gte: today.startUTC, $lt: today.endUTC },
      };
    } else if (tab === "tomorrow") {
      dateFilter = {
        "trip.dropDateTime": { $gte: tomorrow.startUTC, $lt: tomorrow.endUTC },
      };
    } else if (tab === "overdue") {
      dateFilter = { "trip.dropDateTime": { $lt: today.startUTC } };
    }

    const wantCounts = String(includeCounts) !== "false";
    const countsPromise = wantCounts
      ? Promise.all([
          countNonCompleted(baseMatch, {
            "trip.dropDateTime": { $gte: today.startUTC, $lt: today.endUTC },
          }),
          countNonCompleted(baseMatch, {}),
          countNonCompleted(baseMatch, {
            "trip.dropDateTime": {
              $gte: tomorrow.startUTC,
              $lt: tomorrow.endUTC,
            },
          }),
          countNonCompleted(baseMatch, {
            "trip.dropDateTime": { $lt: today.startUTC },
          }),
          VehicleReturn.countDocuments({
            returnStatus: "completed",
            receivingTime: { $gte: completedSince },
          }),
        ]).then(
          ([
            todayCount,
            allCount,
            tomorrowCount,
            overdueCount,
            completedCount,
          ]) => ({
            today: todayCount,
            all: allCount,
            tomorrow: tomorrowCount,
            overdue: overdueCount,
            completed: completedCount,
          }),
        )
      : Promise.resolve(null);

    // Built once, used by both branches (runs while counts are computing)
    const searchFilter = await buildHandoverSearchFilter(searchTerm);

    let data = [];
    let total = 0;
    let hasMore = false;

    if (tab === "completed") {
      const returnMatch = {
        returnStatus: "completed",
        receivingTime: { $gte: completedSince },
      };

      // NEW: Completed tab now respects search too
      if (searchFilter) {
        const matched = await Handover.find({ ...baseMatch, ...searchFilter })
          .select("_id")
          .lean();
        returnMatch.handover = { $in: matched.map((h) => h._id) };
      }

      const [count, returnsPage] = await Promise.all([
        VehicleReturn.countDocuments(returnMatch),
        VehicleReturn.find(returnMatch)
          .select(
            "handover receivedBy receivingTime scheduledReturnTime timeStatus delayText settlementDetails",
          )
          .populate("receivedBy", "fullName role")
          .sort({ receivingTime: -1 })
          .skip((pageNum - 1) * limitNum)
          .limit(limitNum)
          .lean(),
      ]);
      total = count;

      const completedMap = new Map(
        returnsPage.map((r) => [String(r.handover), r]),
      );
      const ids = returnsPage.map((r) => r.handover);

      const handoverDocs = ids.length
        ? await Handover.find({ ...baseMatch, _id: { $in: ids } })
            .select(
              "vehicle trip customer createdAt bookingId assignedDriver createdBy payment",
            )
            .populate({
              path: "vehicle.vehicleId",
              select: "vehicleName vehicleNumber images",
            })
            .populate("createdBy", "fullName role")
            .populate(
              "assignedDriver",
              "fullName mobileNumber profileImage role",
            )
            .populate({ path: "bookingId", select: "drop" })
            .lean()
        : [];

      // Preserve VehicleReturn's receivingTime-desc order
      const order = new Map(ids.map((id, i) => [String(id), i]));
      handoverDocs.sort(
        (a, b) => order.get(String(a._id)) - order.get(String(b._id)),
      );

      hasMore = (pageNum - 1) * limitNum + returnsPage.length < total;
      data = buildResponseRows(handoverDocs, completedMap);
    } else {
      // ==========================================================
      // STAGE 1 — ids only. Tab window + search are filtered by MongoDB,
      // no populate, no JS filtering.
      // ==========================================================
      const candidates = await Handover.find({
        ...baseMatch,
        ...dateFilter,
        ...(searchFilter || {}),
      })
        .select("_id")
        .sort({ "trip.dropDateTime": 1 })
        .lean();

      const candidateIds = candidates.map((h) => h._id);
      const returns = candidateIds.length
        ? await VehicleReturn.find({
            handover: { $in: candidateIds },
            returnStatus: "completed",
          })
            .select("handover")
            .lean()
        : [];
      const completedIdSet = new Set(returns.map((r) => String(r.handover)));

      const notCompletedIds = candidateIds.filter(
        (id) => !completedIdSet.has(String(id)),
      );

      total = notCompletedIds.length;
      const start = (pageNum - 1) * limitNum;
      const pageIds = notCompletedIds.slice(start, start + limitNum);
      hasMore = start + pageIds.length < total;

      // ==========================================================
      // STAGE 2 — full populate, ONLY for the ids on this page.
      // ==========================================================
      let handoverDocs = [];
      if (pageIds.length) {
        handoverDocs = await Handover.find({ _id: { $in: pageIds } })
          .select(
            "vehicle trip customer createdAt bookingId assignedDriver createdBy payment",
          )
          .populate({
            path: "vehicle.vehicleId",
            select: "vehicleName vehicleNumber images",
          })
          .populate("createdBy", "fullName role")
          .populate("assignedDriver", "fullName mobileNumber profileImage role")
          .populate({ path: "bookingId", select: "drop" })
          .lean();

        const order = new Map(pageIds.map((id, i) => [String(id), i]));
        handoverDocs.sort(
          (a, b) => order.get(String(a._id)) - order.get(String(b._id)),
        );
      }

      data = buildResponseRows(handoverDocs, new Map());
    }

    const counts = await countsPromise;

    return res.status(200).json({
      success: true,
      tab,
      page: pageNum,
      limit: limitNum,
      total,
      hasMore,
      counts,
      data,
    });
  } catch (error) {
    console.error("GET RECEIVE CAR LIST ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch receive car list",
    });
  }
};

function buildResponseRows(handoverDocs, completedMap) {
  return handoverDocs.map((h) => {
    const returnInfo = completedMap.get(String(h._id));
    return {
      ...h,
      dropLocation: h.bookingId?.drop?.location || "Office",
      dropCharge: h.bookingId?.drop?.charge || 0,
      createdByUser: h.createdBy
        ? { fullName: h.createdBy.fullName, role: h.createdBy.role }
        : null,
      returnStatus: returnInfo ? "completed" : null,
      returnDetails: returnInfo
        ? {
            receivedBy: returnInfo.receivedBy
              ? {
                  fullName: returnInfo.receivedBy.fullName,
                  role: returnInfo.receivedBy.role,
                }
              : null,
            receivingTime: returnInfo.receivingTime || null,
            scheduledReturnTime: returnInfo.scheduledReturnTime || null,
            timeStatus: returnInfo.timeStatus || "On Time",
            delayText: returnInfo.delayText || "0 minutes",
            settlementDetails: returnInfo.settlementDetails || {},
          }
        : null,
    };
  });
}

// ACTIVE RENTAL EDIT APIS
function buildBillSummaryResponse(handover) {
  const payment = handover.payment || {};
  const extensionBills = handover.extensionBills || [];

  const billSummary = payment.billSummary || {};

  // ever made, regardless of how Mongo returns/stores the array.
  const sortedExtensionBills = [...extensionBills].sort(
    (a, b) => (a.billNumber || 0) - (b.billNumber || 0),
  );

  const totalExtensionAmount = sortedExtensionBills.reduce(
    (sum, bill) => sum + (bill.extensionAmount || 0),
    0,
  );

  const baseFare = Math.max(0, (payment.totalFare || 0) - totalExtensionAmount);

  const originalNumberOfDays =
    sortedExtensionBills.length > 0
      ? sortedExtensionBills[0].previousNumberOfDays
      : handover.trip?.numberOfDays;

  const originalDropDateTime =
    sortedExtensionBills.length > 0
      ? sortedExtensionBills[0].previousDropDateTime
      : handover.trip?.dropDateTime;

  // "Previous bill total" = what totalFare was right before the CURRENT
  // in-progress edit — i.e. baseFare + every extension already applied.
  // If this rental has never been extended, there's no "previous bill"
  // distinct from the original booking, so this equals baseFare.
  const previousBillTotal = payment.totalFare || 0;

  return {
    originalBill: {
      pickupDateTime: handover.trip?.pickupDateTime,
      dropDateTime: originalDropDateTime,
      numberOfDays: originalNumberOfDays,
      baseFare,
    },

    // Sorted oldest -> newest so the collapsible history list in the
    // UI always displays extensions in the order they actually happened.
    extensionBills: sortedExtensionBills.map((bill) => ({
      billNumber: bill.billNumber,
      previousDropDateTime: bill.previousDropDateTime,
      newDropDateTime: bill.newDropDateTime,
      previousNumberOfDays: bill.previousNumberOfDays,
      newNumberOfDays: bill.newNumberOfDays,
      extraDays: bill.extraDays,
      extensionAmount: bill.extensionAmount,
      amountCollected: bill.amountCollected,
      totalFareAfterThisBill: bill.totalFareAfterThisBill,
      reason: bill.reason,
      createdAt: bill.createdAt,
    })),

    previousBillTotal,

    // FIX: pickupCharge/dropCharge added — previously absent entirely
    // from this object, so the frontend always read them as undefined.
    charges: {
      baseFare,
      totalExtensionAmount,
      totalFare: billSummary.totalFare ?? payment.totalFare ?? 0,
      fastTagPayableAmount:
        billSummary.fastTagPayable ?? payment.fastTagPayableAmount ?? 0,
      pickupCharge: billSummary.pickupCharge || 0,
      dropCharge: billSummary.dropCharge || 0,
      securityDeposit:
        billSummary.securityDeposit ?? payment.securityDeposit ?? 0,
      extraCharges: billSummary.extraCharges ?? payment.extraCharges ?? 0,
      discountAmount: billSummary.discountAmount ?? payment.discountAmount ?? 0,
    },

    // FIX: flat fields matching payment.billSummary's own field names
    // exactly, so this is what the frontend actually reads
    // (billSummary.pickupCharge, billSummary.totalAmount,
    // billSummary.balanceAmount, etc.) instead of the old
    // grandTotal/balanceDue names it never looked for.
    pickupCharge: billSummary.pickupCharge || 0,
    dropCharge: billSummary.dropCharge || 0,
    totalAmount: billSummary.totalAmount ?? payment.totalAmount ?? 0,
    totalCollected:
      billSummary.totalCollected ??
      (payment.bookingAmountPaid || 0) + (payment.amountReceivedNow || 0),
    balanceAmount: billSummary.balanceAmount ?? payment.balanceAmount ?? 0,
    paymentStatus: payment.paymentStatus || "pending",

    // Kept for backwards compatibility if anything else still reads
    // these older names — same values as totalAmount/balanceAmount.
    grandTotal: billSummary.totalAmount ?? payment.totalAmount ?? 0,
    balanceDue: billSummary.balanceAmount ?? payment.balanceAmount ?? 0,
  };
}

export const getRentalDetails = async (req, res) => {
  try {
    const { id } = req.params;

    // FIX (perf): .lean() returns a plain JS object instead of a full
    // Mongoose document — skips hydration/getters/virtuals we don't use
    // here, which is a meaningful win on a document this size. If
    // buildBillSummaryResponse() (or anything else below) relies on
    // Mongoose instance methods, virtuals, or Document-only behavior,
    // switch those call sites to work with the plain object first —
    // .lean() objects don't have them.
    const handover = await Handover.findById(id)
      .populate("bookingId", "bookingCode")
      .lean();

    if (!handover || handover.isDeleted) {
      return res.status(404).json({
        success: false,
        message: "Rental not found",
      });
    }

    const billSummary = buildBillSummaryResponse(handover);

    let lastLocation = null;
    if (handover.customer?.mobileNumber) {
      try {
        const Customer = (await import("../models/customer.model.js")).default;
        const customerDoc = await Customer.findOne({
          mobileNumber: handover.customer.mobileNumber,
        }).lean();
        if (customerDoc && customerDoc.lastLocation) {
          lastLocation = customerDoc.lastLocation;
        }
      } catch (e) {
        console.error("Error fetching customer location:", e);
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        _id: handover._id,

        customerName: handover.customer?.fullName || "",
        customerPhone: handover.customer?.mobileNumber || "",
        customerLocation: lastLocation,
        bookingCode: handover.bookingId?.bookingCode || "",

        vehicleId: handover.vehicle?.vehicleId,
        vehicleModel: handover.vehicle?.vehicleName || "",
        plateNumber: handover.vehicle?.vehicleNumber || "",
        vehicleColor: handover.vehicle?.vehicleColor || "",

        pickupDateTime: handover.trip?.pickupDateTime,
        dropDateTime: handover.trip?.dropDateTime,
        numberOfDays: handover.trip?.numberOfDays,

        // Derived, not stored — see buildBillSummaryResponse
        baseFare: billSummary.charges.baseFare,
        totalFare: handover.payment?.totalFare || 0,
        fastagCharges: handover.payment?.fastTagPayableAmount || 0,
        securityDeposit: handover.payment?.securityDeposit || 0,
        extraCharges: handover.payment?.extraCharges || 0,
        discountAmount: handover.payment?.discountAmount || 0,
        bookingAmountPaid: handover.payment?.bookingAmountPaid || 0,
        amountReceivedPreviously: handover.payment?.amountReceivedNow || 0,
        totalAmount: handover.payment?.totalAmount || 0,
        balanceAmount: handover.payment?.balanceAmount || 0,
        paymentMethod: handover.payment?.paymentMethod || "",
        paymentStatus: handover.payment?.paymentStatus || "pending",

        // FIX: flat fallback fields, matching what EditRentalScreen.js
        // reads via `data.billSummary?.pickupCharge ?? data.pickupCharge`.
        // Kept in sync with billSummary.pickupCharge/dropCharge so this
        // fallback path is never silently stale if billSummary's shape
        // changes later.
        pickupCharge: billSummary.pickupCharge,
        dropCharge: billSummary.dropCharge,

        billSummary,
      },
    });
  } catch (error) {
    console.error("GET RENTAL DETAILS ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch rental details",
    });
  }
};

export const getBillSummary = async (req, res) => {
  try {
    const { id } = req.params;

    const handover = await Handover.findById(id);

    if (!handover || handover.isDeleted) {
      return res.status(404).json({
        success: false,
        message: "Rental not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: buildBillSummaryResponse(handover),
    });
  } catch (error) {
    console.error("GET BILL SUMMARY ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch bill summary",
    });
  }
};

const formatDropTime = (date) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const hour = Number(parts.find((p) => p.type === "hour").value);
  const minute = Number(parts.find((p) => p.type === "minute").value);

  const hour12 = hour % 12 || 12;
  const period = hour >= 12 ? "PM" : "AM";

  return `${String(hour12).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${period}`;
};
//v1.0
export const updateRentals = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      vehicleId,
      dropDateTime,
      extensionPrice,
      fastagCharges,
      securityDeposit,
      extraCharges,
      discountAmount,
      amountReceivedNow,
      paymentMethod,
      reasonForChange,
      upiLast4,
    } = req.body;

    // ==========================================================
    // VALIDATE UPI LAST 4 DIGITS (only relevant for phonepe)
    // Reject early rather than letting a malformed value fail
    // silently at handover.save() / PaymentHistory.create().
    // ==========================================================

    let sanitizedUpiLast4 = [];

    if (paymentMethod === "phonepe" && Number(amountReceivedNow) > 0) {
      let references = upiLast4;

      // Support old frontend: "1234"
      if (typeof references === "string") {
        try {
          // Support new frontend: '["1234","5678"]'
          references = JSON.parse(references);
        } catch {
          // Old frontend single value
          references = [references];
        }
      }

      // Safety
      if (!Array.isArray(references)) {
        references = [references];
      }

      sanitizedUpiLast4 = references
        .map((value) => String(value || "").trim())
        .filter(Boolean);

      // Validate every reference
      const invalidReference = sanitizedUpiLast4.some(
        (value) => !/^\d{4}$/.test(value),
      );

      if (sanitizedUpiLast4.length === 0 || invalidReference) {
        return res.status(400).json({
          success: false,
          message: "Please provide valid 4-digit PhonePe reference numbers",
        });
      }
    }

    // ==========================================================
    // FIND ACTIVE RENTAL
    // ==========================================================

    const handover = await Handover.findOne({
      _id: id,
      isDeleted: false,
      handoverStatus: "active",
    });

    if (!handover) {
      return res.status(404).json({
        success: false,
        message: "Active rental not found",
      });
    }

    // ==========================================================
    // CHANGE VEHICLE
    // ==========================================================

    if (
      vehicleId &&
      handover.vehicle?.vehicleId &&
      vehicleId.toString() !== handover.vehicle.vehicleId.toString()
    ) {
      const oldVehicleId = handover.vehicle.vehicleId;

      const oldVehicleName = handover.vehicle.vehicleName;

      const oldVehicleNumber = handover.vehicle.vehicleNumber;

      const vehicle = await Vehicle.findById(vehicleId);

      if (!vehicle || vehicle.isDeleted) {
        return res.status(404).json({
          success: false,
          message: "Vehicle not found",
        });
      }

      if (!["available", "rent"].includes(vehicle.status)) {
        return res.status(400).json({
          success: false,
          message: "Vehicle is not available",
        });
      }

      // Old vehicle becomes available
      await Vehicle.findByIdAndUpdate(oldVehicleId, {
        status: "available",
      });

      // New vehicle becomes rented
      await Vehicle.findByIdAndUpdate(vehicle._id, {
        status: "rent",
      });

      // Vehicle change history
      handover.vehicleHistory.push({
        oldVehicle: {
          vehicleId: oldVehicleId,
          vehicleName: oldVehicleName,
          vehicleNumber: oldVehicleNumber,
        },

        newVehicle: {
          vehicleId: vehicle._id,
          vehicleName: vehicle.vehicleName,
          vehicleNumber: vehicle.vehicleNumber,
        },

        changedBy: req.user._id,
        changedAt: new Date(),
        reason: reasonForChange || "",
      });

      // Update current vehicle
      handover.vehicle.vehicleId = vehicle._id;

      handover.vehicle.vehicleName = vehicle.vehicleName;

      handover.vehicle.vehicleNumber = vehicle.vehicleNumber;

      handover.vehicle.vehicleColor = vehicle.color || "";
    }

    // ==========================================================
    // UPDATE DROP DATE / TIME
    //
    // This updates:
    // 1. Handover dropDateTime
    // 2. Handover numberOfDays
    // 3. Extension bill history
    // 4. Cumulative totalFare
    // ==========================================================

    if (dropDateTime !== undefined) {
      const previousDropDateTime = new Date(handover.trip.dropDateTime);

      const previousNumberOfDays = Number(handover.trip.numberOfDays) || 1;

      const newDrop = new Date(dropDateTime);

      // Validate new date
      if (Number.isNaN(newDrop.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid drop date/time",
        });
      }

      const dropChanged = previousDropDateTime.getTime() !== newDrop.getTime();

      if (dropChanged) {
        const pickup = new Date(handover.trip.pickupDateTime);

        // Validate pickup date
        if (Number.isNaN(pickup.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Invalid pickup date/time",
          });
        }

        // Prevent drop before pickup
        if (newDrop.getTime() < pickup.getTime()) {
          return res.status(400).json({
            success: false,
            message: "Drop date/time cannot be before pickup date/time",
          });
        }

        // Calculate new rental days
        const newNumberOfDays = Math.max(
          1,
          Math.ceil(
            (newDrop.getTime() - pickup.getTime()) / (1000 * 60 * 60 * 24),
          ),
        );

        const extraDays = newNumberOfDays - previousNumberOfDays;

        const extensionAmount = Number(extensionPrice) || 0;

        // ------------------------------------------------------
        // UPDATE HANDOVER TRIP
        // ------------------------------------------------------

        handover.trip.dropDateTime = newDrop;

        handover.trip.numberOfDays = newNumberOfDays;

        // ------------------------------------------------------
        // UPDATE CUMULATIVE TOTAL FARE
        // ------------------------------------------------------

        handover.payment.totalFare =
          (Number(handover.payment.totalFare) || 0) + extensionAmount;

        // ------------------------------------------------------
        // CREATE EXTENSION BILL HISTORY
        // ------------------------------------------------------

        handover.extensionBills.push({
          billNumber: handover.extensionBills.length + 1,

          previousDropDateTime,

          newDropDateTime: newDrop,

          previousNumberOfDays,

          newNumberOfDays,

          extraDays,

          extensionAmount,

          amountCollected: Number(amountReceivedNow) || 0,

          totalFareAfterThisBill: handover.payment.totalFare,

          reason: reasonForChange || "",

          createdBy: req.user._id,

          createdAt: new Date(),
        });
      }
    }

    // ==========================================================
    // UPDATE OTHER PAYMENT FIELDS
    // ==========================================================

    if (fastagCharges !== undefined) {
      handover.payment.fastTagPayableAmount = Number(fastagCharges) || 0;
    }

    if (securityDeposit !== undefined) {
      handover.payment.securityDeposit = Number(securityDeposit) || 0;
    }

    if (extraCharges !== undefined) {
      handover.payment.extraCharges = Number(extraCharges) || 0;
    }

    if (discountAmount !== undefined) {
      handover.payment.discountAmount = Number(discountAmount) || 0;
    }

    if (paymentMethod) {
      handover.payment.paymentMethod = paymentMethod;
    }

    // ==========================================================
    // GET PICKUP / DROP CHARGES
    // ==========================================================

    const pickupCharge =
      Number(handover.payment.billSummary?.pickupCharge) || 0;

    const dropCharge = Number(handover.payment.billSummary?.dropCharge) || 0;

    // ==========================================================
    // CALCULATE TOTAL AMOUNT
    // ==========================================================

    handover.payment.totalAmount = Math.max(
      0,
      (Number(handover.payment.totalFare) || 0) +
        (Number(handover.payment.fastTagPayableAmount) || 0) +
        pickupCharge +
        dropCharge +
        (Number(handover.payment.securityDeposit) || 0) +
        (Number(handover.payment.extraCharges) || 0) -
        (Number(handover.payment.discountAmount) || 0),
    );

    // ==========================================================
    // PAYMENT RECEIVED NOW
    // ==========================================================

    if (amountReceivedNow !== undefined) {
      const received = Number(amountReceivedNow) || 0;

      handover.payment.amountReceivedNow =
        (Number(handover.payment.amountReceivedNow) || 0) + received;

      if (paymentMethod === "cash") {
        handover.payment.paymentBreakdown.cash =
          (Number(handover.payment.paymentBreakdown.cash) || 0) + received;
      } else if (paymentMethod === "phonepe") {
        handover.payment.paymentBreakdown.phonePe =
          (Number(handover.payment.paymentBreakdown.phonePe) || 0) + received;

        // Keep the last-used UPI reference on the handover itself too,
        // so it's visible without having to look up PaymentHistory.
        handover.payment.upiLast4 = sanitizedUpiLast4;
      } else if (paymentMethod === "razorpay") {
        handover.payment.paymentBreakdown.razorpay =
          (Number(handover.payment.paymentBreakdown.razorpay) || 0) + received;
      }
    }

    // ==========================================================
    // CALCULATE TOTAL PAID
    // ==========================================================

    const totalPaidSoFar =
      (Number(handover.payment.bookingAmountPaid) || 0) +
      (Number(handover.payment.amountReceivedNow) || 0);

    // ==========================================================
    // UPDATE BILL SUMMARY
    // ==========================================================

    handover.payment.billSummary = {
      totalFare: Number(handover.payment.totalFare) || 0,

      fastTagPayable: Number(handover.payment.fastTagPayableAmount) || 0,

      pickupCharge,

      dropCharge,

      securityDeposit: Number(handover.payment.securityDeposit) || 0,

      extraCharges: Number(handover.payment.extraCharges) || 0,

      discountAmount: Number(handover.payment.discountAmount) || 0,

      totalAmount: handover.payment.totalAmount,

      bookingAmountPaid: Number(handover.payment.bookingAmountPaid) || 0,

      amountReceivedNow: Number(handover.payment.amountReceivedNow) || 0,

      totalCollected: totalPaidSoFar,

      balanceAmount: Math.max(0, handover.payment.totalAmount - totalPaidSoFar),
    };

    // ==========================================================
    // UPDATE NOTES
    // ==========================================================

    if (reasonForChange?.trim()) {
      const updateNote = `
[Rental Updated - ${new Date().toLocaleString()}]
Reason: ${reasonForChange}
`;

      handover.notes = `${handover.notes || ""}
${updateNote}`
        .trim()
        .slice(-500);
    }

    if (handover.bookingId) {
      const booking = await Booking.findById(handover.bookingId);

      if (booking) {
        // ------------------------------------------------------
        // DROP DATE + TIME
        // ------------------------------------------------------

        const updatedDropDateTime = new Date(handover.trip.dropDateTime);

        if (Number.isNaN(updatedDropDateTime.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Invalid drop date/time for booking",
          });
        }

        // Booking.toDate
        booking.toDate = updatedDropDateTime;

        // Booking.dropTime
        booking.dropTime = formatDropTime(updatedDropDateTime);

        // Booking.totalDays
        booking.totalDays = Math.max(
          1,
          Number(handover.trip.numberOfDays) || 1,
        );

        // ------------------------------------------------------
        // SYNC VEHICLE
        // ------------------------------------------------------

        if (handover.vehicle) {
          booking.vehicleId = handover.vehicle.vehicleId;

          booking.vehicleName =
            handover.vehicle.vehicleName || booking.vehicleName;

          booking.vehicleNumber =
            handover.vehicle.vehicleNumber || booking.vehicleNumber;

          booking.vehicleColor =
            handover.vehicle.vehicleColor || booking.vehicleColor;
        }

        // ------------------------------------------------------
        // SYNC PAYMENT
        // ------------------------------------------------------

        booking.payment.vehicleRent = Number(handover.payment.totalFare) || 0;

        booking.payment.fastagAmount =
          Number(handover.payment.fastTagPayableAmount) || 0;

        booking.payment.discountAmount =
          Number(handover.payment.discountAmount) || 0;

        booking.payment.securityDeposit =
          Number(handover.payment.securityDeposit) || 0;

        // ------------------------------------------------------
        // BOOKING TOTAL
        //
        // Keep the same formula used by Booking.
        // ------------------------------------------------------

        booking.payment.totalAmount = Math.max(
          0,
          (Number(booking.payment.vehicleRent) || 0) +
            (Number(booking.payment.pickupCharge) || 0) +
            (Number(booking.payment.dropCharge) || 0) +
            (Number(booking.payment.fastagAmount) || 0),
        );

        await booking.save();
      }
    }

    // ==========================================================
    // SAVE HANDOVER
    // ==========================================================

    await handover.save();

    if (Number(amountReceivedNow) > 0) {
      try {
        await PaymentHistory.create({
          company: handover.company,

          bookingId: handover.bookingId,

          handoverId: handover._id,

          customer: {
            fullName: handover.customer?.fullName || "",

            mobileNumber: handover.customer?.mobileNumber || "",
          },

          vehicle: {
            vehicleId: handover.vehicle?.vehicleId || null,

            vehicleName: handover.vehicle?.vehicleName || "",

            vehicleNumber: handover.vehicle?.vehicleNumber || "",
          },

          amount: Number(amountReceivedNow),

          paymentMethod: paymentMethod || "phonepe",

          // Only ever store a UPI reference when it actually applies —
          // sanitizedUpiLast4 was validated up front and is "" for
          // any non-phonepe payment, matching the schema's regex
          // (which allows an empty string or exactly 4 digits).
          upiLast4: sanitizedUpiLast4,

          paymentBreakdown: {
            cash: paymentMethod === "cash" ? Number(amountReceivedNow) : 0,

            phonePe:
              paymentMethod === "phonepe" ? Number(amountReceivedNow) : 0,

            razorpay:
              paymentMethod === "razorpay" ? Number(amountReceivedNow) : 0,
          },

          type: "extension",

          note: reasonForChange?.trim()
            ? `Rental payment - ${reasonForChange.trim()}`
            : "Payment received during rental update",

          createdBy: req.user._id,
        });
      } catch (paymentHistoryError) {
        // Payment history failure must not
        // break the rental update.

        console.error(
          "Payment History Creation Error:",
          paymentHistoryError?.message || paymentHistoryError,
        );
      }
    }

    // ==========================================================
    // SUCCESS RESPONSE
    // ==========================================================

    return res.status(200).json({
      success: true,
      message: "Rental updated successfully",

      data: {
        handover,

        billSummary: buildBillSummaryResponse(handover),
      },
    });
  } catch (error) {
    console.error("UPDATE RENTAL ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to update rental",
    });
  }
};
//v1.1
export const updateRentall = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      vehicleId,
      dropDateTime,
      extensionPrice,
      fastagCharges,
      securityDeposit,
      extraCharges,
      discountAmount,
      amountReceivedNow,
      paymentMethod,
      reasonForChange,
      upiLast4,
    } = req.body;

    // ==========================================================
    // HELPER
    // Get Cloudinary URL from uploaded file
    // ==========================================================

    const getUploadedImage = (files, field) => {
      return files?.[field]?.[0]?.path || "";
    };

    // ==========================================================
    // VALIDATE UPI LAST 4 DIGITS
    //
    // FIX: The frontend now supports multiple PhonePe references per
    // payment and sends them as a JSON-stringified array via FormData
    // (e.g. '["1234","5678"]'), since FormData can only carry strings.
    // sanitizedUpiLast4 is now always an ARRAY of 4-digit strings —
    // every place that reads it below (handover.payment.upiLast4,
    // PaymentHistory.upiLast4) must store it as an array too.
    // ==========================================================

    let sanitizedUpiLast4 = [];

    if (paymentMethod === "phonepe" && Number(amountReceivedNow) > 0) {
      let parsedUpiLast4 = upiLast4;

      // Parse the JSON array string back into a real array. Falls back
      // to wrapping the raw value in an array if it isn't valid JSON,
      // so an older client still sending a bare 4-digit string keeps
      // working without a hard break.
      if (typeof parsedUpiLast4 === "string") {
        try {
          parsedUpiLast4 = JSON.parse(parsedUpiLast4);
        } catch {
          parsedUpiLast4 = [parsedUpiLast4];
        }
      }

      if (!Array.isArray(parsedUpiLast4)) {
        parsedUpiLast4 = [parsedUpiLast4];
      }

      sanitizedUpiLast4 = parsedUpiLast4
        .map((value) => String(value || "").trim())
        .filter(Boolean);

      const allValid =
        sanitizedUpiLast4.length > 0 &&
        sanitizedUpiLast4.every((value) => /^\d{4}$/.test(value));

      if (!allValid) {
        return res.status(400).json({
          success: false,
          message: "Please provide valid 4-digit PhonePe reference number(s)",
        });
      }
    }

    // ==========================================================
    // FIND ACTIVE RENTAL
    // ==========================================================

    const handover = await Handover.findOne({
      _id: id,
      isDeleted: false,
      handoverStatus: "active",
    });

    if (!handover) {
      return res.status(404).json({
        success: false,
        message: "Active rental not found",
      });
    }

    // ==========================================================
    // VEHICLE EXCHANGE
    // ==========================================================

    const isVehicleExchange =
      vehicleId &&
      handover.vehicle?.vehicleId &&
      vehicleId.toString() !== handover.vehicle.vehicleId.toString();

    if (isVehicleExchange) {
      // --------------------------------------------------------
      // OLD VEHICLE DETAILS
      // --------------------------------------------------------

      const oldVehicleId = handover.vehicle.vehicleId;
      const oldVehicleName = handover.vehicle.vehicleName;
      const oldVehicleNumber = handover.vehicle.vehicleNumber;

      // --------------------------------------------------------
      // FIND NEW VEHICLE
      // --------------------------------------------------------

      const vehicle = await Vehicle.findById(vehicleId);

      if (!vehicle || vehicle.isDeleted) {
        return res.status(404).json({
          success: false,
          message: "Vehicle not found",
        });
      }

      // --------------------------------------------------------
      // CHECK VEHICLE STATUS
      // --------------------------------------------------------

      if (!["available", "rent"].includes(vehicle.status)) {
        return res.status(400).json({
          success: false,
          message: "Vehicle is not available",
        });
      }

      // --------------------------------------------------------
      // VALIDATE REQUIRED EXCHANGE PHOTOS
      // --------------------------------------------------------

      const requiredExchangePhotos = [
        "vehicleFront",
        "vehicleRear",
        "vehicleLeft",
        "vehicleRight",
      ];

      const missingPhotos = requiredExchangePhotos.filter(
        (field) => !req.files?.[field]?.length,
      );

      if (missingPhotos.length > 0) {
        return res.status(400).json({
          success: false,
          message: "All four vehicle exchange photos are required",
          missingPhotos,
        });
      }

      // --------------------------------------------------------
      // GET CLOUDINARY URLS
      // --------------------------------------------------------

      const exchangeImages = {
        vehicleFront: getUploadedImage(req.files, "vehicleFront"),

        vehicleRear: getUploadedImage(req.files, "vehicleRear"),

        vehicleLeft: getUploadedImage(req.files, "vehicleLeft"),

        vehicleRight: getUploadedImage(req.files, "vehicleRight"),
        additional: getUploadedImage(req.files, "additional"),
      };

      // --------------------------------------------------------
      // EXTRA SAFETY CHECK
      // --------------------------------------------------------

      const invalidExchangeImages = Object.entries(exchangeImages)
        .filter(([, url]) => !url)
        .map(([field]) => field);

      if (invalidExchangeImages.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Failed to upload vehicle exchange photos",
          invalidImages: invalidExchangeImages,
        });
      }

      // --------------------------------------------------------
      // OLD VEHICLE -> AVAILABLE
      // --------------------------------------------------------

      await Vehicle.findByIdAndUpdate(oldVehicleId, {
        status: "available",
      });

      // --------------------------------------------------------
      // NEW VEHICLE -> RENT
      // --------------------------------------------------------

      await Vehicle.findByIdAndUpdate(vehicle._id, {
        status: "rent",
      });

      // --------------------------------------------------------
      // VEHICLE CHANGE HISTORY
      // --------------------------------------------------------

      handover.vehicleHistory.push({
        oldVehicle: {
          vehicleId: oldVehicleId,
          vehicleName: oldVehicleName,
          vehicleNumber: oldVehicleNumber,
        },

        newVehicle: {
          vehicleId: vehicle._id,
          vehicleName: vehicle.vehicleName,
          vehicleNumber: vehicle.vehicleNumber,
        },

        // IMPORTANT:
        // These photos belong to THIS exchange,
        // not the original handover.
        exchangeImages,

        changedBy: req.user._id,

        changedAt: new Date(),

        reason: reasonForChange || "",
      });

      // --------------------------------------------------------
      // UPDATE CURRENT VEHICLE
      // --------------------------------------------------------

      handover.vehicle.vehicleId = vehicle._id;

      handover.vehicle.vehicleName = vehicle.vehicleName;

      handover.vehicle.vehicleNumber = vehicle.vehicleNumber;

      handover.vehicle.vehicleColor = vehicle.color || "";
    }

    // ==========================================================
    // UPDATE DROP DATE / TIME
    //
    // This updates:
    // 1. Handover dropDateTime
    // 2. Handover numberOfDays
    // 3. Extension bill history
    // 4. Cumulative totalFare
    // ==========================================================

    if (dropDateTime !== undefined) {
      const previousDropDateTime = new Date(handover.trip.dropDateTime);

      const previousNumberOfDays = Number(handover.trip.numberOfDays) || 1;

      const newDrop = new Date(dropDateTime);

      // --------------------------------------------------------
      // VALIDATE NEW DATE
      // --------------------------------------------------------

      if (Number.isNaN(newDrop.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid drop date/time",
        });
      }

      const dropChanged = previousDropDateTime.getTime() !== newDrop.getTime();

      if (dropChanged) {
        const pickup = new Date(handover.trip.pickupDateTime);

        // ------------------------------------------------------
        // VALIDATE PICKUP DATE
        // ------------------------------------------------------

        if (Number.isNaN(pickup.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Invalid pickup date/time",
          });
        }

        // ------------------------------------------------------
        // PREVENT DROP BEFORE PICKUP
        // ------------------------------------------------------

        if (newDrop.getTime() < pickup.getTime()) {
          return res.status(400).json({
            success: false,
            message: "Drop date/time cannot be before pickup date/time",
          });
        }

        // ------------------------------------------------------
        // CALCULATE NEW RENTAL DAYS
        // ------------------------------------------------------

        const newNumberOfDays = Math.max(
          1,
          Math.ceil(
            (newDrop.getTime() - pickup.getTime()) / (1000 * 60 * 60 * 24),
          ),
        );

        const extraDays = newNumberOfDays - previousNumberOfDays;

        const extensionAmount = Number(extensionPrice) || 0;

        // ------------------------------------------------------
        // UPDATE HANDOVER TRIP
        // ------------------------------------------------------

        handover.trip.dropDateTime = newDrop;

        handover.trip.numberOfDays = newNumberOfDays;

        // ------------------------------------------------------
        // UPDATE CUMULATIVE TOTAL FARE
        // ------------------------------------------------------

        handover.payment.totalFare =
          (Number(handover.payment.totalFare) || 0) + extensionAmount;

        // ------------------------------------------------------
        // CREATE EXTENSION BILL HISTORY
        // ------------------------------------------------------

        handover.extensionBills.push({
          billNumber: handover.extensionBills.length + 1,

          previousDropDateTime,

          newDropDateTime: newDrop,

          previousNumberOfDays,

          newNumberOfDays,

          extraDays,

          extensionAmount,

          amountCollected: Number(amountReceivedNow) || 0,

          totalFareAfterThisBill: handover.payment.totalFare,

          reason: reasonForChange || "",

          createdBy: req.user._id,

          createdAt: new Date(),
        });
      }
    }

    // ==========================================================
    // UPDATE OTHER PAYMENT FIELDS
    // ==========================================================

    if (fastagCharges !== undefined) {
      handover.payment.fastTagPayableAmount = Number(fastagCharges) || 0;
    }

    if (securityDeposit !== undefined) {
      handover.payment.securityDeposit = Number(securityDeposit) || 0;
    }

    if (extraCharges !== undefined) {
      handover.payment.extraCharges = Number(extraCharges) || 0;
    }

    if (discountAmount !== undefined) {
      handover.payment.discountAmount = Number(discountAmount) || 0;
    }

    if (paymentMethod) {
      handover.payment.paymentMethod = paymentMethod;
    }

    // ==========================================================
    // GET PICKUP / DROP CHARGES
    // ==========================================================

    const pickupCharge =
      Number(handover.payment.billSummary?.pickupCharge) || 0;

    const dropCharge = Number(handover.payment.billSummary?.dropCharge) || 0;

    // ==========================================================
    // CALCULATE TOTAL AMOUNT
    // ==========================================================

    handover.payment.totalAmount = Math.max(
      0,

      (Number(handover.payment.totalFare) || 0) +
        (Number(handover.payment.fastTagPayableAmount) || 0) +
        pickupCharge +
        dropCharge +
        (Number(handover.payment.securityDeposit) || 0) +
        (Number(handover.payment.extraCharges) || 0) -
        (Number(handover.payment.discountAmount) || 0),
    );

    // ==========================================================
    // PAYMENT RECEIVED NOW
    // ==========================================================

    if (amountReceivedNow !== undefined) {
      const received = Number(amountReceivedNow) || 0;

      handover.payment.amountReceivedNow =
        (Number(handover.payment.amountReceivedNow) || 0) + received;

      if (paymentMethod === "cash") {
        handover.payment.paymentBreakdown.cash =
          (Number(handover.payment.paymentBreakdown.cash) || 0) + received;
      } else if (paymentMethod === "phonepe") {
        handover.payment.paymentBreakdown.phonePe =
          (Number(handover.payment.paymentBreakdown.phonePe) || 0) + received;

        // Keep the latest set of UPI references from this update.
        // FIX: sanitizedUpiLast4 is now an array — handover.payment.upiLast4
        // must be typed [String] in the Handover schema for this to save
        // correctly (see schema note below).
        handover.payment.upiLast4 = sanitizedUpiLast4;
      } else if (paymentMethod === "razorpay") {
        handover.payment.paymentBreakdown.razorpay =
          (Number(handover.payment.paymentBreakdown.razorpay) || 0) + received;
      }
    }

    // ==========================================================
    // CALCULATE TOTAL PAID
    // ==========================================================

    const totalPaidSoFar =
      (Number(handover.payment.bookingAmountPaid) || 0) +
      (Number(handover.payment.amountReceivedNow) || 0);

    // ==========================================================
    // UPDATE BILL SUMMARY
    // ==========================================================

    handover.payment.billSummary = {
      totalFare: Number(handover.payment.totalFare) || 0,

      fastTagPayable: Number(handover.payment.fastTagPayableAmount) || 0,

      pickupCharge,

      dropCharge,

      securityDeposit: Number(handover.payment.securityDeposit) || 0,

      extraCharges: Number(handover.payment.extraCharges) || 0,

      discountAmount: Number(handover.payment.discountAmount) || 0,

      totalAmount: handover.payment.totalAmount,

      bookingAmountPaid: Number(handover.payment.bookingAmountPaid) || 0,

      amountReceivedNow: Number(handover.payment.amountReceivedNow) || 0,

      totalCollected: totalPaidSoFar,

      balanceAmount: Math.max(0, handover.payment.totalAmount - totalPaidSoFar),
    };

    // ==========================================================
    // UPDATE NOTES
    // ==========================================================

    if (reasonForChange?.trim()) {
      const updateNote = `
[Rental Updated - ${new Date().toLocaleString()}]
Reason: ${reasonForChange}
`;

      handover.notes = `${handover.notes || ""}
${updateNote}`
        .trim()
        .slice(-500);
    }

    // ==========================================================
    // SYNC BOOKING
    // ==========================================================

    if (handover.bookingId) {
      const booking = await Booking.findById(handover.bookingId);

      if (booking) {
        // ------------------------------------------------------
        // DROP DATE + TIME
        // ------------------------------------------------------

        const updatedDropDateTime = new Date(handover.trip.dropDateTime);

        if (Number.isNaN(updatedDropDateTime.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Invalid drop date/time for booking",
          });
        }

        // Booking.toDate
        booking.toDate = updatedDropDateTime;

        // Booking.dropTime
        booking.dropTime = formatDropTime(updatedDropDateTime);

        // Booking.totalDays
        booking.totalDays = Math.max(
          1,
          Number(handover.trip.numberOfDays) || 1,
        );

        // ------------------------------------------------------
        // SYNC VEHICLE
        // ------------------------------------------------------

        if (handover.vehicle) {
          booking.vehicleId = handover.vehicle.vehicleId;

          booking.vehicleName =
            handover.vehicle.vehicleName || booking.vehicleName;

          booking.vehicleNumber =
            handover.vehicle.vehicleNumber || booking.vehicleNumber;

          booking.vehicleColor =
            handover.vehicle.vehicleColor || booking.vehicleColor;
        }

        // ------------------------------------------------------
        // SYNC PAYMENT
        // ------------------------------------------------------

        booking.payment.vehicleRent = Number(handover.payment.totalFare) || 0;

        booking.payment.fastagAmount =
          Number(handover.payment.fastTagPayableAmount) || 0;

        booking.payment.discountAmount =
          Number(handover.payment.discountAmount) || 0;

        booking.payment.securityDeposit =
          Number(handover.payment.securityDeposit) || 0;

        // ------------------------------------------------------
        // BOOKING TOTAL
        // ------------------------------------------------------

        booking.payment.totalAmount = Math.max(
          0,

          (Number(booking.payment.vehicleRent) || 0) +
            (Number(booking.payment.pickupCharge) || 0) +
            (Number(booking.payment.dropCharge) || 0) +
            (Number(booking.payment.fastagAmount) || 0),
        );

        await booking.save();
      }
    }

    // ==========================================================
    // SAVE HANDOVER
    // ==========================================================

    await handover.save();

    // ==========================================================
    // PAYMENT HISTORY
    // ==========================================================

    if (Number(amountReceivedNow) > 0) {
      try {
        await PaymentHistory.create({
          company: handover.company,

          bookingId: handover.bookingId,

          handoverId: handover._id,

          customer: {
            fullName: handover.customer?.fullName || "",

            mobileNumber: handover.customer?.mobileNumber || "",
          },

          vehicle: {
            vehicleId: handover.vehicle?.vehicleId || null,

            vehicleName: handover.vehicle?.vehicleName || "",

            vehicleNumber: handover.vehicle?.vehicleNumber || "",
          },

          amount: Number(amountReceivedNow),

          paymentMethod: paymentMethod || "phonepe",

          // FIX: array of 4-digit strings, matching PaymentHistory's
          // upiLast4: [String] schema field.
          upiLast4: sanitizedUpiLast4,

          paymentBreakdown: {
            cash: paymentMethod === "cash" ? Number(amountReceivedNow) : 0,

            phonePe:
              paymentMethod === "phonepe" ? Number(amountReceivedNow) : 0,

            razorpay:
              paymentMethod === "razorpay" ? Number(amountReceivedNow) : 0,
          },

          type: "extension",

          note: reasonForChange?.trim()
            ? `Rental payment - ${reasonForChange.trim()}`
            : "Payment received during rental update",

          createdBy: req.user._id,
        });
      } catch (paymentHistoryError) {
        // Payment history failure must not
        // break the rental update.

        console.error(
          "Payment History Creation Error:",
          paymentHistoryError?.message || paymentHistoryError,
        );
      }
    }

    // ==========================================================
    // SUCCESS RESPONSE
    // ==========================================================

    return res.status(200).json({
      success: true,

      message: "Rental updated successfully",

      data: {
        handover,

        billSummary: buildBillSummaryResponse(handover),
      },
    });
  } catch (error) {
    console.error("UPDATE RENTAL ERROR:", error);

    return res.status(500).json({
      success: false,

      message: error.message || "Failed to update rental",
    });
  }
};
//v1.2
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  LayoutAnimation,
  Linking, // FIX: was used for "Track Location" but never imported
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from "react-native";
import api from "../../../services/api";
import useAuthStore from "../../../store/authStore";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const formatMoney = (value) =>
  `₹${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatDate = (date) =>
  new Date(date).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });

const formatTime = (date) =>
  new Date(date).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });

const sanitizeAmountInput = (text) => {
  let cleaned = text.replace(/[^0-9.]/g, "");

  const firstDot = cleaned.indexOf(".");
  if (firstDot !== -1) {
    cleaned =
      cleaned.slice(0, firstDot + 1) +
      cleaned.slice(firstDot + 1).replace(/\./g, "");
  }

  return cleaned;
};

const makeAmountHandler = (setter) => (text) =>
  setter(sanitizeAmountInput(text));

const isValidDate = (value) => {
  if (!value) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
};

export default function EditRentalScreen() {
  const router = useRouter();
  const {
    rentalId,
    customerName: navCustomerName,
    customerPhone: navCustomerPhone,
    vehicleModel: navVehicleModel,
    plateNumber: navPlateNumber,
    pickupDateTime: navPickupDateTime,
    newDropDate,
    extensionId,
  } = useLocalSearchParams();
  const { token } = useAuthStore();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const [showBillSummary, setShowBillSummary] = useState(true);
  const [showRecapSummary, setShowRecapSummary] = useState(true);

  const [customerInfo, setCustomerInfo] = useState({
    name: navCustomerName || "",
    phone: navCustomerPhone || "",
    location: null,
  });
  const [vehicleInfo, setVehicleInfo] = useState({
    model: navVehicleModel || "",
    plateNumber: navPlateNumber || "",
  });
  const [bookingCode, setBookingCode] = useState("");
  const [pickupDate, setPickupDate] = useState(
    isValidDate(navPickupDateTime) ? new Date(navPickupDateTime) : new Date(),
  );

  const [originalDropDateTime, setOriginalDropDateTime] = useState(new Date());
  const [originalNumberOfDays, setOriginalNumberOfDays] = useState(1);
  const [dropDateTime, setDropDateTime] = useState(new Date());

  const [baseFare, setBaseFare] = useState(0);
  const [previousBillTotal, setPreviousBillTotal] = useState(0);
  const [extensionPrice, setExtensionPrice] = useState("0");
  const [fastagPayable, setFastagPayable] = useState("0");
  const [securityDeposit, setSecurityDeposit] = useState("0");
  const [extraCharges, setExtraCharges] = useState("0");
  const [discountAmount, setDiscountAmount] = useState("0");
  const [amountReceivedNow, setAmountReceivedNow] = useState("0");
  const [reasonForChange, setReasonForChange] = useState("");

  const [paymentType, setPaymentType] = useState("cash");
  const [phonePeLastFour, setPhonePeLastFour] = useState([""]);

  // NEW: refund given back to the customer (when rental is shortened)
  const [amountRefundedNow, setAmountRefundedNow] = useState("0");
  const [refundMethod, setRefundMethod] = useState("cash");
  const [amountRefundedPreviously, setAmountRefundedPreviously] = useState(0);

  const onExtensionPriceChange = makeAmountHandler(setExtensionPrice);
  const onFastagChange = makeAmountHandler(setFastagPayable);
  const onSecurityDepositChange = makeAmountHandler(setSecurityDeposit);
  const onExtraChargesChange = makeAmountHandler(setExtraCharges);
  const onDiscountChange = makeAmountHandler(setDiscountAmount);
  const onAmountReceivedNowChange = makeAmountHandler(setAmountReceivedNow);
  const onAmountRefundedNowChange = makeAmountHandler(setAmountRefundedNow);

  const [pickupCharge, setPickupCharge] = useState(0);
  const [dropCharge, setDropCharge] = useState(0);

  const [bookingAmountPaid, setBookingAmountPaid] = useState(0);
  const [amountReceivedPreviously, setAmountReceivedPreviously] = useState(0);

  const [billSummary, setBillSummary] = useState(null);

  const [vehicles, setVehicles] = useState([]);
  const [vehicleLoading, setVehicleLoading] = useState(false);
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [vehicleSearch, setVehicleSearch] = useState("");

  const [exchangePhotos, setExchangePhotos] = useState({
    vehicleFront: null,
    vehicleRear: null,
    vehicleLeft: null,
    vehicleRight: null,
    additional: null,
  });
  const [originalVehicleId, setOriginalVehicleId] = useState(null);

  const filteredVehicles = vehicles.filter((vehicle) => {
    const search = vehicleSearch.toLowerCase();
    return (
      vehicle?.vehicleName?.toLowerCase().includes(search) ||
      vehicle?.vehicleNumber?.toLowerCase().includes(search) ||
      vehicle?.color?.toLowerCase().includes(search)
    );
  });

  const handlePhonePeLastFourChange = (index, text) => {
    const value = text.replace(/[^0-9]/g, "").slice(0, 4);
    setPhonePeLastFour((prev) => {
      const updated = [...prev];
      updated[index] = value;
      return updated;
    });
  };
  const addPhonePeReference = () => setPhonePeLastFour((prev) => [...prev, ""]);
  const removePhonePeReference = (index) =>
    setPhonePeLastFour((prev) => prev.filter((_, i) => i !== index));

  useEffect(() => {
    fetchRentalDetails();
  }, [rentalId]);

  const dropChanged = useMemo(
    () =>
      new Date(dropDateTime).getTime() !==
      new Date(originalDropDateTime).getTime(),
    [dropDateTime, originalDropDateTime],
  );

  // NEW: direction of the change (compared by time, not day count)
  const isShortened =
    dropChanged &&
    new Date(dropDateTime).getTime() < new Date(originalDropDateTime).getTime();
  const isExtended = dropChanged && !isShortened;

  const isVehicleExchange =
    Boolean(originalVehicleId) &&
    Boolean(selectedVehicle?._id) &&
    originalVehicleId !== selectedVehicle._id.toString();

  const newNumberOfDays = useMemo(() => {
    const days = Math.ceil(
      (new Date(dropDateTime) - new Date(pickupDate)) / (1000 * 60 * 60 * 24),
    );
    return Math.max(1, days);
  }, [dropDateTime, pickupDate]);

  const extraDays = newNumberOfDays - originalNumberOfDays;

  const currentExtensionAmount = parseFloat(extensionPrice) || 0;

  // CHANGED: extension adds, reduction subtracts
  const liveTotalFare = useMemo(() => {
    if (!dropChanged) return previousBillTotal;
    if (isShortened) {
      return Math.max(0, previousBillTotal - currentExtensionAmount);
    }
    return previousBillTotal + currentExtensionAmount;
  }, [previousBillTotal, currentExtensionAmount, dropChanged, isShortened]);

  const fastag = parseFloat(fastagPayable) || 0;
  const deposit = parseFloat(securityDeposit) || 0;
  const extra = parseFloat(extraCharges) || 0;
  const discount = parseFloat(discountAmount) || 0;
  const currentReceived = parseFloat(amountReceivedNow) || 0;
  const currentRefund = parseFloat(amountRefundedNow) || 0;

  const liveBillSummary = useMemo(() => {
    const totalAmount = Math.max(
      0,
      liveTotalFare +
        fastag +
        pickupCharge +
        dropCharge +
        deposit +
        extra -
        discount,
    );

    const amountReceivedNowCumulative =
      amountReceivedPreviously + currentReceived;

    // What the company holds BEFORE this refund
    const netBeforeRefund =
      bookingAmountPaid +
      amountReceivedNowCumulative -
      amountRefundedPreviously;

    // Max that can be refunded right now
    const refundable = Math.max(0, netBeforeRefund - totalAmount);

    const refundedTotal = amountRefundedPreviously + currentRefund;

    const totalCollected =
      bookingAmountPaid + amountReceivedNowCumulative - refundedTotal;

    const balanceAmount = Math.max(0, totalAmount - totalCollected);
    const refundDue = Math.max(0, totalCollected - totalAmount);

    return {
      totalFare: liveTotalFare,
      fastTagPayable: fastag,
      pickupCharge,
      dropCharge,
      securityDeposit: deposit,
      extraCharges: extra,
      discountAmount: discount,
      totalAmount,
      bookingAmountPaid,
      amountReceivedNow: amountReceivedNowCumulative,
      refundedAmount: refundedTotal,
      refundable,
      totalCollected,
      balanceAmount,
      refundDue,
    };
  }, [
    liveTotalFare,
    fastag,
    pickupCharge,
    dropCharge,
    deposit,
    extra,
    discount,
    bookingAmountPaid,
    amountReceivedPreviously,
    currentReceived,
    amountRefundedPreviously,
    currentRefund,
  ]);

  const grandTotal = liveBillSummary.totalAmount;
  const balanceAmount = liveBillSummary.balanceAmount;
  const refundDue = liveBillSummary.refundDue;
  const refundable = liveBillSummary.refundable;

  // Show refund section when customer has overpaid or a refund is typed
  const showRefundSection = refundable > 0 || currentRefund > 0;

  const fetchRentalDetails = async () => {
    try {
      setLoading(true);
      const cleanId = Array.isArray(rentalId) ? rentalId[0] : rentalId;
      if (!cleanId) return;

      const response = await api.get(`/handover/rentals/${cleanId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = response.data.data;
      const serverBillSummary = data.billSummary || null;

      setCustomerInfo({
        name: data.customerName,
        phone: data.customerPhone,
        location: data.customerLocation,
      });
      setBookingCode(data.bookingCode || "");
      setVehicleInfo({
        model: data.vehicleModel,
        plateNumber: data.plateNumber,
      });

      const currentVehicleId = data.vehicleId?.toString();
      setOriginalVehicleId(currentVehicleId);

      setSelectedVehicle({
        _id: data.vehicleId,
        vehicleName: data.vehicleModel,
        vehicleNumber: data.plateNumber,
        color: data.vehicleColor,
      });

      setPickupDate(new Date(data.pickupDateTime));
      setOriginalDropDateTime(new Date(data.dropDateTime));
      if (newDropDate && isValidDate(newDropDate)) {
        setDropDateTime(new Date(newDropDate));
      } else {
        setDropDateTime(new Date(data.dropDateTime));
      }

      setOriginalNumberOfDays(
        serverBillSummary?.originalBill?.numberOfDays || data.numberOfDays || 1,
      );

      setBaseFare(Number(data.baseFare) || 0);
      setPreviousBillTotal(
        Number(serverBillSummary?.previousBillTotal ?? data.totalFare) || 0,
      );
      setExtensionPrice("0");

      setFastagPayable(String(data.fastagCharges || 0));
      setSecurityDeposit(String(data.securityDeposit || 0));
      setExtraCharges(String(data.extraCharges || 0));
      setDiscountAmount(String(data.discountAmount || 0));

      setBookingAmountPaid(data.bookingAmountPaid || 0);
      setAmountReceivedPreviously(data.amountReceivedPreviously || 0);

      // NEW: needs the GET endpoint to send this (see notes)
      setAmountRefundedPreviously(
        Number(
          data.amountRefundedPreviously ?? serverBillSummary?.refundedAmount,
        ) || 0,
      );

      setPickupCharge(
        Number(serverBillSummary?.pickupCharge ?? data.pickupCharge) || 0,
      );
      setDropCharge(
        Number(serverBillSummary?.dropCharge ?? data.dropCharge) || 0,
      );

      setBillSummary(serverBillSummary);

      setExchangePhotos({
        vehicleFront: null,
        vehicleRear: null,
        vehicleLeft: null,
        vehicleRight: null,
        additional: null,
      });

      setPaymentType("cash");
      setPhonePeLastFour([""]);
      setAmountRefundedNow("0");
      setRefundMethod("cash");
    } catch (error) {
      Alert.alert("Error", "Failed to load rental details.");
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailableVehicles = async () => {
    try {
      setVehicleLoading(true);
      const res = await api.get("/vehicles/available", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setVehicles(res.data.data || []);
    } finally {
      setVehicleLoading(false);
    }
  };

  const openVehicleModal = () => {
    setShowVehicleModal(true);
    if (vehicles.length === 0 && !vehicleLoading) {
      fetchAvailableVehicles();
    }
  };

  const onDateChange = (event, selectedDate) => {
    setShowDatePicker(false);
    if (selectedDate) {
      const current = new Date(dropDateTime);
      current.setFullYear(
        selectedDate.getFullYear(),
        selectedDate.getMonth(),
        selectedDate.getDate(),
      );
      setDropDateTime(current);
    }
  };
  const IST_OFFSET_MINUTES = 5 * 60 + 30;

  const istWallClockToUtcIso = (date) => {
    const utcMillis = Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
      date.getSeconds(),
    );
    return new Date(utcMillis - IST_OFFSET_MINUTES * 60 * 1000).toISOString();
  };

  const onTimeChange = (event, selectedTime) => {
    setShowTimePicker(false);
    if (selectedTime) {
      const current = new Date(dropDateTime);
      current.setHours(selectedTime.getHours(), selectedTime.getMinutes());
      setDropDateTime(current);
    }
  };

  const toggleHistory = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowHistory((prev) => !prev);
  };

  const toggleBillSummary = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowBillSummary((prev) => !prev);
  };

  const toggleRecapSummary = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowRecapSummary((prev) => !prev);
  };

  const pickExchangePhoto = async (field) => {
    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          "Permission Required",
          "Please allow photo library access.",
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        quality: 0.8,
      });

      if (result.canceled || !result.assets?.length) return;

      setExchangePhotos((prev) => ({
        ...prev,
        [field]: result.assets[0],
      }));
    } catch (error) {
      Alert.alert("Error", "Unable to select the image.");
    }
  };

  const captureExchangePhoto = async (field) => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Permission Required", "Please allow camera access.");
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        quality: 0.8,
      });

      if (result.canceled || !result.assets?.length) return;

      setExchangePhotos((prev) => ({
        ...prev,
        [field]: result.assets[0],
      }));
    } catch (error) {
      Alert.alert("Error", "Unable to capture the image.");
    }
  };

  const selectExchangePhoto = (field, label) => {
    Alert.alert(`${label} Photo`, "Choose how you want to add the photo.", [
      { text: "Camera", onPress: () => captureExchangePhoto(field) },
      { text: "Gallery", onPress: () => pickExchangePhoto(field) },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const removeExchangePhoto = (field) => {
    setExchangePhotos((prev) => ({ ...prev, [field]: null }));
  };

  const validateExchangePhotos = () => {
    if (!isVehicleExchange) return true;

    const requiredPhotos = [
      { key: "vehicleFront", label: "Front" },
      { key: "vehicleRear", label: "Rear" },
      { key: "vehicleLeft", label: "Left" },
      { key: "vehicleRight", label: "Right" },
    ];

    const missingPhotos = requiredPhotos
      .filter(({ key }) => !exchangePhotos[key])
      .map(({ label }) => label);

    if (missingPhotos.length > 0) {
      Alert.alert(
        "Vehicle Photos Required",
        `Please add the following photos:\n\n${missingPhotos.join("\n")}`,
      );
      return false;
    }
    return true;
  };

  const handleSaveChanges = async () => {
    if (!reasonForChange.trim()) {
      Alert.alert(
        "Validation Error",
        "Please provide a reason for modification.",
      );
      return;
    }

    // NEW: drop must stay after pickup
    if (
      dropChanged &&
      new Date(dropDateTime).getTime() <= new Date(pickupDate).getTime()
    ) {
      Alert.alert(
        "Invalid Drop Date",
        "Drop date and time must be after the pickup date and time.",
      );
      return;
    }

    // CHANGED: only extensions require a charge
    if (isExtended && currentExtensionAmount <= 0) {
      Alert.alert(
        "Extension Amount Required",
        "You extended the drop date — please enter the extension charge for this new bill.",
      );
      return;
    }

    // NEW: reduction cannot be more than the fare so far
    if (isShortened && currentExtensionAmount > previousBillTotal) {
      Alert.alert(
        "Invalid Reduction",
        `Fare reduction cannot be more than the current total fare (${formatMoney(previousBillTotal)}).`,
      );
      return;
    }

    if (currentReceived > 0) {
      if (
        paymentType === "phonepe" &&
        (phonePeLastFour.length === 0 ||
          phonePeLastFour.some((value) => value.length !== 4))
      ) {
        Alert.alert(
          "Payment Details Required",
          "Please enter valid 4-digit PhonePe reference numbers.",
        );
        return;
      }
    }

    // NEW: refund cannot exceed the overpaid amount
    if (currentRefund > 0 && currentRefund > refundable + 0.001) {
      Alert.alert(
        "Invalid Refund",
        `You can refund at most ${formatMoney(refundable)}.`,
      );
      return;
    }

    if (!validateExchangePhotos()) return;

    try {
      setSubmitting(true);
      const cleanId = Array.isArray(rentalId) ? rentalId[0] : rentalId;
      const formData = new FormData();

      formData.append("vehicleId", selectedVehicle?._id?.toString() || "");
      formData.append("dropDateTime", istWallClockToUtcIso(dropDateTime));
      // Positive number for both cases — the server decides +/− by
      // comparing the new drop with the current one.
      formData.append(
        "extensionPrice",
        String(dropChanged ? Number(extensionPrice) || 0 : 0),
      );
      formData.append("fastagCharges", String(Number(fastagPayable)));
      formData.append("securityDeposit", String(Number(securityDeposit)));
      formData.append("extraCharges", String(Number(extraCharges)));
      formData.append("discountAmount", String(Number(discountAmount)));
      formData.append("amountReceivedNow", String(Number(amountReceivedNow)));
      formData.append("paymentMethod", currentReceived > 0 ? paymentType : "");
      formData.append(
        "upiLast4",
        currentReceived > 0 && paymentType === "phonepe"
          ? JSON.stringify(phonePeLastFour.filter(Boolean))
          : "",
      );
      // NEW
      formData.append("amountRefundedNow", String(currentRefund));
      formData.append("refundMethod", currentRefund > 0 ? refundMethod : "");
      formData.append("reasonForChange", reasonForChange);

      if (isVehicleExchange) {
        const photoFields = [
          "vehicleFront",
          "vehicleRear",
          "vehicleLeft",
          "vehicleRight",
          "additional",
        ];
        photoFields.forEach((field) => {
          const photo = exchangePhotos[field];
          if (photo?.uri) {
            formData.append(field, {
              uri: photo.uri,
              name: `${field}.jpg`,
              type: photo.mimeType || "image/jpeg",
            });
          }
        });
      }

      const response = await api.put(
        `/handover/rentals/edit/${cleanId}`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "multipart/form-data",
          },
        },
      );

      if (extensionId) {
        try {
          await api.put(`/extensions/${extensionId}/status`, {
            status: "approved",
          });
        } catch (extError) {
          console.warn("Could not mark extension as approved:", extError);
        }
      }

      Alert.alert(
        "Success",
        response?.data?.message || "Rental updated successfully",
        [{ text: "OK", onPress: () => router.replace("/(tabs)/home") }],
      );
    } catch (error) {
      Alert.alert(
        "Error",
        error?.response?.data?.message || "Failed to update changes.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const renderExchangePhoto = (field, label) => {
    const photo = exchangePhotos[field];
    return (
      <View style={styles.exchangePhotoItem} key={field}>
        <Text style={styles.exchangePhotoLabel}>
          {label}
          <Text style={styles.requiredText}> *</Text>
        </Text>
        <TouchableOpacity
          style={[
            styles.exchangePhotoBox,
            photo && styles.exchangePhotoBoxFilled,
          ]}
          onPress={() => selectExchangePhoto(field, label)}
          activeOpacity={0.8}
        >
          {photo?.uri ? (
            <>
              <Image
                source={{ uri: photo.uri }}
                style={styles.exchangePhotoPreview}
              />
              <TouchableOpacity
                style={styles.removeExchangePhotoButton}
                onPress={() => removeExchangePhoto(field)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.removeExchangePhotoText}>×</Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={styles.exchangePhotoPlaceholder}>
              <Text style={styles.exchangePhotoIcon}>+</Text>
              <Text style={styles.exchangePhotoPlaceholderText}>Add Photo</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  const hasHistory = (billSummary?.extensionBills?.length || 0) > 0;

  return (
    <SafeAreaView style={styles.rootSafeArea}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoidingView}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
      >
        <StatusBar backgroundColor="#001B45" barStyle="light-content" />

        <LinearGradient colors={["#001B45", "#002B6B"]} style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.sideBtn}
          >
            <Ionicons name="chevron-back" size={26} color="white" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Modify Rental Contract</Text>
          <View style={styles.sideBtn} />
        </LinearGradient>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={styles.formContainer}>
            <View style={styles.readOnlyCard}>
              <Text style={styles.cardHeaderLabel}>Account Reference</Text>
              {bookingCode ? (
                <Text style={styles.readOnlyText}>
                  <Text style={{ fontWeight: "700" }}>Booking ID </Text>
                  {bookingCode}
                </Text>
              ) : null}
              <Text style={styles.readOnlyText}>
                <Text style={{ fontWeight: "700" }}>Customer </Text>
                {customerInfo.name} • {customerInfo.phone}
              </Text>
              {customerInfo.location?.coordinates &&
                customerInfo.location.coordinates.length === 2 && (
                  <TouchableOpacity
                    onPress={() => {
                      const [lng, lat] = customerInfo.location.coordinates;
                      Linking.openURL(
                        `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
                      );
                    }}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      marginTop: 8,
                      padding: 8,
                      backgroundColor: "#EFF6FF",
                      borderRadius: 8,
                      alignSelf: "flex-start",
                    }}
                  >
                    <Ionicons name="location" size={16} color="#2563EB" />
                    <Text
                      style={{
                        color: "#2563EB",
                        marginLeft: 6,
                        fontWeight: "600",
                        fontSize: 13,
                      }}
                    >
                      Track Location
                    </Text>
                  </TouchableOpacity>
                )}
              <View style={{ height: 12 }} />
              <Text style={styles.readOnlyText}>
                <Text style={{ fontWeight: "700" }}>Vehicle </Text>
                {vehicleInfo.model} · {vehicleInfo.plateNumber}
              </Text>
            </View>

            <Text style={styles.fieldLabel}>Vehicle</Text>
            <TouchableOpacity
              style={styles.inputField}
              onPress={openVehicleModal}
            >
              <Ionicons name="car-sport-outline" size={18} color="#64748B" />
              <Text style={{ flex: 1, marginLeft: 10 }}>
                {selectedVehicle
                  ? `${selectedVehicle.vehicleName} • ${selectedVehicle.vehicleNumber}${
                      selectedVehicle.pricePerDay
                        ? ` • ₹${selectedVehicle.pricePerDay}/day`
                        : ""
                    }`
                  : vehicleInfo.model
                    ? `${vehicleInfo.model} • ${vehicleInfo.plateNumber}`
                    : "Select Vehicle"}
              </Text>
              <Ionicons name="chevron-forward" size={18} color="#64748B" />
            </TouchableOpacity>

            {isVehicleExchange && (
              <View style={styles.exchangePhotoSection}>
                <View style={styles.exchangePhotoHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.exchangePhotoTitle}>
                      Vehicle Exchange Photos
                    </Text>
                    <Text style={styles.exchangePhotoSubtitle}>
                      New vehicle photos are required for the exchange record.
                    </Text>
                  </View>
                </View>
                <View style={styles.exchangeVehicleInfo}>
                  <Text style={styles.exchangeVehicleInfoLabel}>
                    New Vehicle
                  </Text>
                  <Text style={styles.exchangeVehicleInfoValue}>
                    {selectedVehicle?.vehicleName || "—"}
                    {selectedVehicle?.vehicleNumber
                      ? ` • ${selectedVehicle.vehicleNumber}`
                      : ""}
                  </Text>
                </View>
                <View style={styles.exchangePhotoGrid}>
                  {renderExchangePhoto("vehicleFront", "Front")}
                  {renderExchangePhoto("vehicleRear", "Rear")}
                  {renderExchangePhoto("vehicleLeft", "Left")}
                  {renderExchangePhoto("vehicleRight", "Right")}
                  {renderExchangePhoto("additional", "Additional")}
                </View>
                <Text style={styles.exchangePhotoHint}>
                  Capture clear photos of all four sides of the new vehicle.
                </Text>
              </View>
            )}

            <SectionHeader title="Trip Management" />

            <View style={styles.row}>
              <LabeledBox
                label="Pickup Date (Fixed)"
                value={formatDate(pickupDate)}
                disabled
              />
              <LabeledBox
                label="Pickup Time (Fixed)"
                value={formatTime(pickupDate)}
                disabled
              />
            </View>

            <View style={styles.row}>
              <View style={styles.flexSplit}>
                <Text style={styles.fieldLabel}>Drop Date</Text>
                <TouchableOpacity
                  style={styles.inputField}
                  onPress={() => setShowDatePicker(true)}
                >
                  <Text style={styles.inputText}>
                    {formatDate(dropDateTime)}
                  </Text>
                  <Ionicons name="calendar-outline" size={18} color="#64748B" />
                </TouchableOpacity>
              </View>
              <View style={styles.flexSplit}>
                <Text style={styles.fieldLabel}>Drop Time</Text>
                <TouchableOpacity
                  style={styles.inputField}
                  onPress={() => setShowTimePicker(true)}
                >
                  <Text style={styles.inputText}>
                    {formatTime(dropDateTime)}
                  </Text>
                  <Ionicons name="time-outline" size={18} color="#64748B" />
                </TouchableOpacity>
              </View>
            </View>

            {dropChanged && (
              <View
                style={[
                  styles.extensionNoticeBanner,
                  isShortened && styles.reductionNoticeBanner,
                ]}
              >
                <Ionicons
                  name="alert-circle"
                  size={16}
                  color={isShortened ? "#B91C1C" : "#B45309"}
                />
                <Text
                  style={[
                    styles.extensionNoticeText,
                    isShortened && styles.reductionNoticeText,
                  ]}
                >
                  {isShortened
                    ? `Shortened by ${Math.abs(extraDays)} day${Math.abs(extraDays) === 1 ? "" : "s"} — enter the fare reduction below.`
                    : `Extended by ${extraDays} day${extraDays === 1 ? "" : "s"} — a new extension bill will be added below.`}
                </Text>
              </View>
            )}

            <SectionHeader
              title="Bill Summary"
              collapsible
              isOpen={showBillSummary}
              onToggle={toggleBillSummary}
            />

            {showBillSummary &&
              (loading ? (
                <BillCardSkeleton />
              ) : (
                <View style={styles.billCard}>
                  <View style={styles.billRow}>
                    <Text style={styles.billRowLabel}>
                      Original Booking{" "}
                      <Text style={styles.billRowSub}>
                        (
                        {billSummary?.originalBill?.numberOfDays ||
                          originalNumberOfDays}{" "}
                        day
                        {(billSummary?.originalBill?.numberOfDays ||
                          originalNumberOfDays) === 1
                          ? ""
                          : "s"}
                        )
                      </Text>
                    </Text>
                    <Text style={styles.billRowValue}>
                      {formatMoney(
                        billSummary?.originalBill?.baseFare ?? baseFare,
                      )}
                    </Text>
                  </View>

                  <View style={styles.billRow}>
                    <Text style={styles.billRowLabel}>Total Fare</Text>
                    <Text style={styles.billRowValue}>
                      {formatMoney(liveTotalFare)}
                    </Text>
                  </View>

                  {hasHistory && (
                    <>
                      <TouchableOpacity
                        style={styles.historyToggle}
                        onPress={toggleHistory}
                      >
                        <Ionicons
                          name="receipt-outline"
                          size={15}
                          color="#2563EB"
                        />
                        <Text style={styles.historyToggleText}>
                          {billSummary.extensionBills.length} previous change
                          {billSummary.extensionBills.length === 1 ? "" : "s"}
                        </Text>
                        <Ionicons
                          name={showHistory ? "chevron-up" : "chevron-down"}
                          size={15}
                          color="#2563EB"
                        />
                      </TouchableOpacity>

                      {showHistory &&
                        billSummary.extensionBills.map((bill) => {
                          const isReductionBill = bill.billType === "reduction";
                          return (
                            <View
                              key={bill.billNumber}
                              style={styles.pastBillCard}
                            >
                              <View style={styles.billRow}>
                                <Text style={styles.billRowLabel}>
                                  {isReductionBill ? "Reduction" : "Extension"}{" "}
                                  #{bill.billNumber}{" "}
                                  <Text style={styles.billRowSub}>
                                    ({bill.extraDays >= 0 ? "+" : ""}
                                    {bill.extraDays}d •{" "}
                                    {formatDate(bill.previousDropDateTime)} →{" "}
                                    {formatDate(bill.newDropDateTime)})
                                  </Text>
                                </Text>
                                <Text
                                  style={[
                                    styles.billRowValue,
                                    isReductionBill && styles.reductionValue,
                                  ]}
                                >
                                  {isReductionBill ? "− " : ""}
                                  {formatMoney(bill.extensionAmount)}
                                </Text>
                              </View>
                              <View style={styles.pastBillMetaRow}>
                                <Text style={styles.pastBillMetaText}>
                                  Collected then:{" "}
                                  {formatMoney(bill.amountCollected)}
                                </Text>
                                <Text style={styles.pastBillMetaText}>
                                  Running total:{" "}
                                  {formatMoney(bill.totalFareAfterThisBill)}
                                </Text>
                              </View>
                              {Number(bill.amountRefunded) > 0 && (
                                <Text style={styles.pastBillMetaText}>
                                  Refunded then:{" "}
                                  {formatMoney(bill.amountRefunded)}
                                </Text>
                              )}
                              {!!bill.reason && (
                                <Text style={styles.pastBillReason}>
                                  "{bill.reason}"
                                </Text>
                              )}
                              {!!bill.createdAt && (
                                <Text style={styles.pastBillDate}>
                                  {formatDate(bill.createdAt)} at{" "}
                                  {formatTime(bill.createdAt)}
                                </Text>
                              )}
                            </View>
                          );
                        })}

                      <View
                        style={[styles.billRow, styles.previousBillTotalRow]}
                      >
                        <Text style={styles.previousBillTotalLabel}>
                          Previous Bill Total
                        </Text>
                        <Text style={styles.previousBillTotalValue}>
                          {formatMoney(previousBillTotal)}
                        </Text>
                      </View>
                    </>
                  )}

                  {dropChanged && (
                    <View
                      style={[
                        styles.billRow,
                        styles.pendingBillRow,
                        isShortened && styles.pendingReductionRow,
                      ]}
                    >
                      <Text
                        style={[
                          styles.billRowLabel,
                          styles.pendingLabel,
                          isShortened && styles.pendingReductionLabel,
                        ]}
                      >
                        {isShortened ? "Fare Reduction" : "New Extension"}{" "}
                        <Text style={styles.billRowSub}>
                          ({extraDays >= 0 ? "+" : ""}
                          {extraDays}d → {formatDate(dropDateTime)})
                        </Text>
                      </Text>
                      <View
                        style={[
                          styles.pendingAmountInput,
                          isShortened && styles.pendingReductionInput,
                        ]}
                      >
                        <Text
                          style={[
                            styles.pendingCurrency,
                            isShortened && styles.pendingReductionLabel,
                          ]}
                        >
                          {isShortened ? "−₹" : "₹"}
                        </Text>
                        <TextInput
                          style={[
                            styles.pendingAmountText,
                            isShortened && styles.pendingReductionLabel,
                          ]}
                          keyboardType="numeric"
                          placeholder="0"
                          value={extensionPrice}
                          onChangeText={onExtensionPriceChange}
                        />
                      </View>
                    </View>
                  )}

                  <View style={styles.billRow}>
                    <Text style={styles.billRowLabel}>Pickup Charge</Text>
                    <Text style={styles.billRowValue}>
                      {formatMoney(pickupCharge)}
                    </Text>
                  </View>
                  <View style={styles.billRow}>
                    <Text style={styles.billRowLabel}>Drop Charge</Text>
                    <Text style={styles.billRowValue}>
                      {formatMoney(dropCharge)}
                    </Text>
                  </View>

                  <View style={styles.billDivider} />

                  <View style={styles.billRow}>
                    <Text style={styles.billRowLabel}>FASTag Charges</Text>
                    <View style={styles.inlineEditField}>
                      <TextInput
                        style={styles.inlineEditText}
                        keyboardType="numeric"
                        value={fastagPayable}
                        onChangeText={onFastagChange}
                      />
                    </View>
                  </View>

                  <View style={styles.billRow}>
                    <Text style={styles.billRowLabel}>Security Deposit</Text>
                    <View style={styles.inlineEditField}>
                      <TextInput
                        style={styles.inlineEditText}
                        keyboardType="numeric"
                        value={securityDeposit}
                        onChangeText={onSecurityDepositChange}
                      />
                    </View>
                  </View>

                  <View style={styles.billRow}>
                    <Text style={styles.billRowLabel}>Extra Charges</Text>
                    <View style={styles.inlineEditField}>
                      <TextInput
                        style={styles.inlineEditText}
                        keyboardType="numeric"
                        value={extraCharges}
                        onChangeText={onExtraChargesChange}
                      />
                    </View>
                  </View>

                  <View style={styles.billRow}>
                    <Text style={styles.billRowLabel}>Discount</Text>
                    <View
                      style={[styles.inlineEditField, styles.discountField]}
                    >
                      <Text style={styles.discountMinus}>−</Text>
                      <TextInput
                        style={styles.inlineEditText}
                        keyboardType="numeric"
                        value={discountAmount}
                        onChangeText={onDiscountChange}
                      />
                    </View>
                  </View>

                  <View style={styles.billDividerDashed} />

                  <View style={styles.billRow}>
                    <Text style={styles.grandTotalLabel}>Grand Total</Text>
                    <Text style={styles.grandTotalValue}>
                      {formatMoney(grandTotal)}
                    </Text>
                  </View>
                </View>
              ))}

            <View style={styles.recapCard}>
              <TouchableOpacity
                style={styles.recapHeaderRow}
                onPress={toggleRecapSummary}
                activeOpacity={0.7}
              >
                <Text style={styles.recapTitle}>Updated Bill Summary</Text>
                <View
                  style={[
                    styles.iconCircle,
                    showRecapSummary && styles.iconCircleActive,
                  ]}
                >
                  <Ionicons
                    name={showRecapSummary ? "chevron-up" : "chevron-down"}
                    size={18}
                    color={showRecapSummary ? "#2563EB" : "#64748B"}
                  />
                </View>
              </TouchableOpacity>

              {showRecapSummary &&
                (loading ? (
                  <>
                    <View style={[styles.skeletonLine, { width: "70%" }]} />
                    <View style={[styles.skeletonLine, { width: "50%" }]} />
                    <View style={[styles.skeletonLine, { width: "65%" }]} />
                  </>
                ) : (
                  <>
                    <RecapRow
                      label="Total Fare"
                      value={liveBillSummary.totalFare}
                    />
                    <RecapRow
                      label="FASTag Payable"
                      value={liveBillSummary.fastTagPayable}
                    />
                    <RecapRow
                      label="Pickup Charge"
                      value={liveBillSummary.pickupCharge}
                    />
                    <RecapRow
                      label="Drop Charge"
                      value={liveBillSummary.dropCharge}
                    />
                    <RecapRow
                      label="Security Deposit"
                      value={liveBillSummary.securityDeposit}
                    />
                    <RecapRow
                      label="Extra Charges"
                      value={liveBillSummary.extraCharges}
                    />
                    <RecapRow
                      label="Discount"
                      value={liveBillSummary.discountAmount}
                      negative
                    />
                    <View style={styles.recapDivider} />
                    <RecapRow
                      label="Total Amount"
                      value={liveBillSummary.totalAmount}
                      emphasize
                    />
                    <RecapRow
                      label="Booking Amount Paid"
                      value={liveBillSummary.bookingAmountPaid}
                    />
                    <RecapRow
                      label="Amount Received (Total)"
                      value={liveBillSummary.amountReceivedNow}
                    />
                    {liveBillSummary.refundedAmount > 0 && (
                      <RecapRow
                        label="Refunded (Total)"
                        value={liveBillSummary.refundedAmount}
                        negative
                      />
                    )}
                    <RecapRow
                      label="Total Collected"
                      value={liveBillSummary.totalCollected}
                    />
                    <View style={styles.recapDivider} />
                    {refundDue > 0 ? (
                      <RecapRow
                        label="Refund Due to Customer"
                        value={refundDue}
                        emphasize
                      />
                    ) : (
                      <RecapRow
                        label="Balance Amount"
                        value={liveBillSummary.balanceAmount}
                        emphasize
                      />
                    )}
                  </>
                ))}
            </View>

            <SectionHeader title="Payment Collection" />

            <View style={styles.row}>
              <LabeledBox
                label="Booking Amount"
                value={formatMoney(bookingAmountPaid)}
                disabled
              />
              <LabeledBox
                label="Collected Previously"
                value={formatMoney(amountReceivedPreviously)}
                disabled
              />
            </View>

            <Text style={styles.fieldLabel}>Collect Payment Now</Text>
            <View style={[styles.inputField, styles.highlightedInput]}>
              <TextInput
                style={styles.textInputBox}
                keyboardType="numeric"
                placeholder="Enter amount collected now"
                value={amountReceivedNow}
                onChangeText={onAmountReceivedNowChange}
              />
            </View>

            {currentReceived > 0 && (
              <>
                <Text style={styles.fieldLabel}>Payment Mode</Text>
                <View style={styles.paymentTypeRow}>
                  <TouchableOpacity
                    style={[
                      styles.paymentTypeBtn,
                      paymentType === "cash" && styles.paymentTypeBtnActive,
                    ]}
                    onPress={() => setPaymentType("cash")}
                  >
                    <Ionicons
                      name="cash-outline"
                      size={18}
                      color={paymentType === "cash" ? "#111827" : "#64748B"}
                    />
                    <Text
                      style={[
                        styles.paymentTypeText,
                        paymentType === "cash" && styles.paymentTypeTextActive,
                      ]}
                    >
                      Cash
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.paymentTypeBtn,
                      paymentType === "phonepe" && styles.paymentTypeBtnActive,
                    ]}
                    onPress={() => setPaymentType("phonepe")}
                  >
                    <Ionicons
                      name="phone-portrait-outline"
                      size={18}
                      color={paymentType === "phonepe" ? "#111827" : "#64748B"}
                    />
                    <Text
                      style={[
                        styles.paymentTypeText,
                        paymentType === "phonepe" &&
                          styles.paymentTypeTextActive,
                      ]}
                    >
                      PhonePe
                    </Text>
                  </TouchableOpacity>
                </View>

                {paymentType === "phonepe" && (
                  <View style={styles.phonePeSection}>
                    <Text style={styles.fieldLabel}>
                      PhonePe Reference Number
                      {phonePeLastFour.length > 1 ? "s" : ""}
                    </Text>
                    <Text style={styles.phonePeHint}>
                      Enter the last 4 digits of each PhonePe transaction
                      reference.
                    </Text>

                    {phonePeLastFour.map((value, index) => {
                      const isComplete = value.length === 4;
                      const isPartial = value.length > 0 && value.length < 4;

                      return (
                        <View key={index} style={styles.phonePeRow}>
                          <View style={styles.phonePeIndexBadge}>
                            <Text style={styles.phonePeIndexText}>
                              {index + 1}
                            </Text>
                          </View>

                          <View
                            style={[
                              styles.phonePeInputWrap,
                              isComplete && styles.phonePeInputWrapValid,
                              isPartial && styles.phonePeInputWrapPartial,
                            ]}
                          >
                            <TextInput
                              style={styles.phonePeInput}
                              value={value}
                              keyboardType="number-pad"
                              maxLength={4}
                              onChangeText={(text) =>
                                handlePhonePeLastFourChange(index, text)
                              }
                              placeholder="0000"
                              placeholderTextColor="#CBD5E1"
                            />
                            {isComplete && (
                              <Ionicons
                                name="checkmark-circle"
                                size={18}
                                color="#16A34A"
                              />
                            )}
                            {isPartial && (
                              <Text style={styles.phonePeCounter}>
                                {value.length}/4
                              </Text>
                            )}
                          </View>

                          {phonePeLastFour.length > 1 && (
                            <TouchableOpacity
                              style={styles.phonePeRemoveBtn}
                              onPress={() => removePhonePeReference(index)}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                              <Ionicons
                                name="close"
                                size={16}
                                color="#DC2626"
                              />
                            </TouchableOpacity>
                          )}
                        </View>
                      );
                    })}

                    <TouchableOpacity
                      style={styles.phonePeAddBtn}
                      onPress={addPhonePeReference}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name="add-circle-outline"
                        size={18}
                        color="#2563EB"
                      />
                      <Text style={styles.phonePeAddText}>
                        Add another reference
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}

            {/* ---------- NEW: REFUND SECTION ---------- */}
            {showRefundSection && (
              <View style={styles.refundSection}>
                <View style={styles.refundHeaderRow}>
                  <Ionicons
                    name="return-down-back-outline"
                    size={18}
                    color="#B91C1C"
                  />
                  <Text style={styles.refundTitle}>Refund to Customer</Text>
                </View>
                <Text style={styles.refundHint}>
                  Customer has paid {formatMoney(refundable)} more than the new
                  total. Enter the amount you are returning now.
                </Text>

                <View style={[styles.inputField, styles.refundInput]}>
                  <Text style={styles.refundCurrency}>₹</Text>
                  <TextInput
                    style={styles.textInputBox}
                    keyboardType="numeric"
                    placeholder="0"
                    value={amountRefundedNow}
                    onChangeText={onAmountRefundedNowChange}
                  />
                  <TouchableOpacity
                    onPress={() => setAmountRefundedNow(String(refundable))}
                    style={styles.refundFullBtn}
                  >
                    <Text style={styles.refundFullText}>Full</Text>
                  </TouchableOpacity>
                </View>

                {currentRefund > 0 && (
                  <>
                    <Text style={styles.fieldLabel}>Refund Mode</Text>
                    <View style={styles.paymentTypeRow}>
                      {[
                        { key: "cash", label: "Cash", icon: "cash-outline" },
                        {
                          key: "phonepe",
                          label: "PhonePe",
                          icon: "phone-portrait-outline",
                        },
                      ].map((opt) => (
                        <TouchableOpacity
                          key={opt.key}
                          style={[
                            styles.paymentTypeBtn,
                            refundMethod === opt.key &&
                              styles.paymentTypeBtnActive,
                          ]}
                          onPress={() => setRefundMethod(opt.key)}
                        >
                          <Ionicons
                            name={opt.icon}
                            size={18}
                            color={
                              refundMethod === opt.key ? "#111827" : "#64748B"
                            }
                          />
                          <Text
                            style={[
                              styles.paymentTypeText,
                              refundMethod === opt.key &&
                                styles.paymentTypeTextActive,
                            ]}
                          >
                            {opt.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}
              </View>
            )}

            <View
              style={[
                styles.calculationBanner,
                refundDue > 0
                  ? styles.creditBanner
                  : balanceAmount > 0
                    ? styles.alertBanner
                    : styles.settledBanner,
              ]}
            >
              <Text style={styles.bannerLabel}>
                {refundDue > 0 ? "Credit Due to Customer" : "Remaining Balance"}
              </Text>
              <Text style={styles.bannerValue}>
                {formatMoney(refundDue > 0 ? refundDue : balanceAmount)}
              </Text>
            </View>

            <SectionHeader />
            <Text style={styles.fieldLabel}>Reason</Text>
            <View style={[styles.inputField, styles.textAreaContainer]}>
              <TextInput
                style={[styles.textInputBox, styles.textArea]}
                multiline
                numberOfLines={3}
                placeholder="Describe the reason for this modification..."
                value={reasonForChange}
                onChangeText={setReasonForChange}
              />
            </View>

            <View style={styles.actionRowGrid}>
              <TouchableOpacity
                style={styles.backCancelButton}
                onPress={() => router.back()}
              >
                <Text style={styles.backButtonText}>Dismiss</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.saveSubmitButton}
                onPress={handleSaveChanges}
                disabled={submitting || loading}
              >
                {submitting ? (
                  <ActivityIndicator color="#111827" />
                ) : (
                  <Text style={styles.saveButtonText}>Submit</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {showDatePicker && (
        <DateTimePicker
          value={dropDateTime}
          mode="date"
          display="default"
          minimumDate={pickupDate}
          onValueChange={onDateChange}
          onDismiss={() => onDateChange({ type: "dismissed" })}
        />
      )}

      {showTimePicker && (
        <DateTimePicker
          value={dropDateTime}
          mode="time"
          is24Hour={false}
          display="default"
          onValueChange={onTimeChange}
          onDismiss={() => onTimeChange({ type: "dismissed" })}
        />
      )}

      <VehiclePickerModal
        visible={showVehicleModal}
        onClose={() => {
          setVehicleSearch("");
          setShowVehicleModal(false);
        }}
        vehicleLoading={vehicleLoading}
        vehicleSearch={vehicleSearch}
        setVehicleSearch={setVehicleSearch}
        filteredVehicles={filteredVehicles}
        selectedVehicle={selectedVehicle}
        onSelect={(vehicle) => {
          setSelectedVehicle(vehicle);
          setVehicleInfo({
            model: vehicle.vehicleName,
            plateNumber: vehicle.vehicleNumber,
          });
          setVehicleSearch("");
          setShowVehicleModal(false);

          if (
            originalVehicleId &&
            vehicle?._id?.toString() === originalVehicleId
          ) {
            setExchangePhotos({
              vehicleFront: null,
              vehicleRear: null,
              vehicleLeft: null,
              vehicleRight: null,
              additional: null,
            });
          }
        }}
      />
    </SafeAreaView>
  );
}

/* ============================================================
   SMALL PRESENTATIONAL COMPONENTS
============================================================ */

function SectionHeader({ title, collapsible, isOpen, onToggle }) {
  const headerContent = (
    <View style={styles.sectionHeaderRow}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {collapsible && (
        <View style={[styles.iconCircle, isOpen && styles.iconCircleActive]}>
          <Ionicons
            name={isOpen ? "chevron-up" : "chevron-down"}
            size={18}
            color={isOpen ? "#2563EB" : "#64748B"}
          />
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.sectionHeader}>
      {collapsible ? (
        <TouchableOpacity
          onPress={onToggle}
          activeOpacity={0.7}
          style={styles.sectionHeaderClickable}
        >
          {headerContent}
        </TouchableOpacity>
      ) : (
        headerContent
      )}
      <View style={styles.yellowLine} />
    </View>
  );
}

function RecapRow({ label, value, negative, emphasize }) {
  return (
    <View style={styles.recapRow}>
      <Text style={[styles.recapLabel, emphasize && styles.recapLabelBold]}>
        {label}
      </Text>
      <Text
        style={[
          styles.recapValue,
          emphasize && styles.recapValueBold,
          negative && value > 0 && styles.recapValueNegative,
        ]}
      >
        {negative && value > 0 ? "− " : ""}
        {formatMoney(value)}
      </Text>
    </View>
  );
}

function LabeledBox({ label, value, disabled }) {
  return (
    <View style={styles.flexSplit}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.inputField, disabled && styles.disabledInput]}>
        <Text style={disabled ? styles.disabledText : styles.inputText}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function BillCardSkeleton() {
  return (
    <View style={styles.billCard}>
      <View style={[styles.skeletonLine, { width: "55%" }]} />
      <View style={[styles.skeletonLine, { width: "35%" }]} />
      <View style={[styles.skeletonLine, { width: "45%" }]} />
      <View style={styles.billDividerDashed} />
      <View style={[styles.skeletonLine, { width: "60%", height: 22 }]} />
    </View>
  );
}

function VehiclePickerModal({
  visible,
  onClose,
  vehicleLoading,
  vehicleSearch,
  setVehicleSearch,
  filteredVehicles,
  selectedVehicle,
  onSelect,
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#F8FAFC" }}>
        <View style={modalStyles.header}>
          <Text style={modalStyles.headerTitle}>Select Vehicle</Text>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={28} color="#111827" />
          </TouchableOpacity>
        </View>

        <View style={modalStyles.searchWrap}>
          <View style={modalStyles.searchBar}>
            <Ionicons name="search" size={20} color="#64748B" />
            <TextInput
              placeholder="Search by name, number or color..."
              placeholderTextColor="#94A3B8"
              value={vehicleSearch}
              onChangeText={setVehicleSearch}
              style={modalStyles.searchInput}
            />
          </View>
        </View>

        {vehicleLoading ? (
          <View
            style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
          >
            <ActivityIndicator size="large" />
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
            {filteredVehicles.map((vehicle) => (
              <TouchableOpacity
                key={vehicle._id}
                style={[
                  modalStyles.vehicleCard,
                  {
                    borderColor:
                      selectedVehicle?._id === vehicle._id
                        ? "#2563EB"
                        : "#E5E7EB",
                  },
                ]}
                onPress={() => onSelect(vehicle)}
              >
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <View style={modalStyles.vehicleIconWrap}>
                    <Ionicons name="car-sport" size={26} color="#2563EB" />
                  </View>

                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={modalStyles.vehicleName}>
                      {vehicle.vehicleName}
                    </Text>
                    <Text style={modalStyles.vehicleNumber}>
                      {vehicle.vehicleNumber}
                    </Text>
                    <Text style={modalStyles.vehicleColor}>
                      Color: {vehicle.color}
                    </Text>
                    {vehicle.pricePerDay ? (
                      <Text style={modalStyles.vehiclePrice}>
                        ₹{vehicle.pricePerDay}/day
                      </Text>
                    ) : null}
                  </View>

                  <Ionicons name="chevron-forward" size={20} color="#94A3B8" />
                </View>
              </TouchableOpacity>
            ))}

            {filteredVehicles.length === 0 && (
              <View style={{ alignItems: "center", marginTop: 60 }}>
                <Ionicons name="car-outline" size={60} color="#CBD5E1" />
                <Text style={modalStyles.emptyText}>No Vehicle Found</Text>
              </View>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

/* ============================================================
   STYLES
============================================================ */

const styles = StyleSheet.create({
  rootSafeArea: { flex: 1, backgroundColor: "#001B45" },
  keyboardAvoidingView: { flex: 1, backgroundColor: "#F8FAFC" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight + 16 : 16,
    paddingBottom: 16,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sideBtn: { width: 42 },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: "white",
    fontSize: 18,
    fontWeight: "800",
  },
  scrollContent: { flexGrow: 1, paddingBottom: 60 },
  formContainer: { paddingHorizontal: 16, paddingTop: 16 },

  readOnlyCard: {
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#BFDBFE",
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  },
  cardHeaderLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#1E40AF",
    marginBottom: 6,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  readOnlyText: { fontSize: 14, color: "#1E3A8A", marginBottom: 4 },

  sectionHeader: { marginTop: 24, marginBottom: 12 },
  sectionHeaderClickable: { paddingVertical: 4 },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: { fontSize: 17, fontWeight: "800", color: "#111827" },
  yellowLine: {
    width: 40,
    height: 3,
    borderRadius: 99,
    backgroundColor: "#FFC107",
    marginTop: 4,
  },

  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  iconCircleActive: {
    backgroundColor: "#DBEAFE",
  },

  row: { flexDirection: "row", gap: 10, marginBottom: 4 },
  flexSplit: { flex: 1 },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#475569",
    marginTop: 10,
    marginBottom: 4,
  },

  inputField: {
    backgroundColor: "white",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    paddingHorizontal: 12,
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  textInputBox: {
    flex: 1,
    height: "100%",
    color: "#0F172A",
    fontSize: 14,
    padding: 0,
  },
  inputText: { color: "#0F172A", fontSize: 14 },
  disabledInput: { backgroundColor: "#F1F5F9", borderColor: "#E2E8F0" },
  disabledText: { color: "#64748B", fontSize: 14 },
  highlightedInput: { borderColor: "#2563EB", borderWidth: 1.5 },
  textAreaContainer: { height: 80, alignItems: "flex-start", paddingTop: 8 },
  textArea: { textAlignVertical: "top" },

  extensionNoticeBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFFBEB",
    borderWidth: 1,
    borderColor: "#FDE68A",
    borderRadius: 10,
    padding: 10,
    marginTop: 10,
  },
  extensionNoticeText: {
    flex: 1,
    fontSize: 12.5,
    color: "#92400E",
    fontWeight: "600",
  },
  reductionNoticeBanner: {
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
  },
  reductionNoticeText: { color: "#991B1B" },

  /* ---------- VEHICLE EXCHANGE PHOTOS ---------- */
  exchangePhotoSection: {
    marginTop: 20,
    padding: 16,
    borderRadius: 14,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  exchangePhotoHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  exchangePhotoTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0F172A",
  },
  exchangePhotoSubtitle: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    color: "#64748B",
  },
  exchangeVehicleInfo: {
    padding: 12,
    marginBottom: 16,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  exchangeVehicleInfoLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#64748B",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  exchangeVehicleInfoValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0F172A",
  },
  exchangePhotoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  exchangePhotoItem: { width: "48%", marginBottom: 14 },
  exchangePhotoLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#334155",
    marginBottom: 7,
  },
  requiredText: { color: "#DC2626" },
  exchangePhotoBox: {
    width: "100%",
    aspectRatio: 1.25,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: "#CBD5E1",
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
  },
  exchangePhotoBoxFilled: { borderStyle: "solid", borderColor: "#CBD5E1" },
  exchangePhotoPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  exchangePhotoIcon: { fontSize: 28, fontWeight: "300", color: "#64748B" },
  exchangePhotoPlaceholderText: {
    marginTop: 4,
    fontSize: 12,
    color: "#64748B",
  },
  exchangePhotoPreview: { width: "100%", height: "100%", resizeMode: "cover" },
  removeExchangePhotoButton: {
    position: "absolute",
    top: 7,
    right: 7,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.7)",
  },
  removeExchangePhotoText: {
    color: "#FFFFFF",
    fontSize: 22,
    lineHeight: 24,
    fontWeight: "400",
  },
  exchangePhotoHint: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 17,
    color: "#64748B",
  },

  /* ---------- BILL CARD ---------- */
  billCard: {
    backgroundColor: "white",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 16,
    shadowColor: "#0F172A",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  billRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
  },
  billRowLabel: {
    fontSize: 14,
    color: "#334155",
    fontWeight: "600",
    flexShrink: 1,
  },
  billRowSub: { fontSize: 12, color: "#94A3B8", fontWeight: "500" },
  billRowValue: { fontSize: 14, color: "#0F172A", fontWeight: "700" },
  reductionValue: { color: "#DC2626" },

  historyToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
  },
  historyToggleText: {
    flex: 1,
    fontSize: 13,
    color: "#2563EB",
    fontWeight: "700",
  },
  pastBillCard: {
    backgroundColor: "#F8FAFC",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingBottom: 8,
    marginBottom: 6,
  },
  pastBillMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: -4,
    marginBottom: 4,
  },
  pastBillMetaText: {
    fontSize: 11.5,
    color: "#64748B",
    fontWeight: "600",
  },
  pastBillReason: {
    fontSize: 11.5,
    color: "#94A3B8",
    fontStyle: "italic",
    marginBottom: 4,
  },
  pastBillDate: {
    fontSize: 10.5,
    color: "#CBD5E1",
    fontWeight: "600",
  },
  previousBillTotalRow: {
    backgroundColor: "#F1F5F9",
    borderRadius: 10,
    paddingHorizontal: 10,
    marginTop: 4,
  },
  previousBillTotalLabel: {
    fontSize: 13.5,
    fontWeight: "800",
    color: "#334155",
  },
  previousBillTotalValue: { fontSize: 15, fontWeight: "800", color: "#0F172A" },

  pendingBillRow: {
    backgroundColor: "#EFF6FF",
    borderRadius: 10,
    paddingHorizontal: 10,
    marginVertical: 2,
  },
  pendingLabel: { color: "#1D4ED8" },
  pendingReductionRow: { backgroundColor: "#FEF2F2" },
  pendingReductionLabel: { color: "#B91C1C" },
  pendingAmountInput: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#93C5FD",
    borderRadius: 8,
    paddingHorizontal: 8,
    height: 34,
    minWidth: 90,
  },
  pendingReductionInput: { borderColor: "#FCA5A5" },
  pendingCurrency: {
    fontSize: 13,
    color: "#1D4ED8",
    fontWeight: "700",
    marginRight: 2,
  },
  pendingAmountText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    color: "#1D4ED8",
    padding: 0,
  },

  inlineEditField: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 34,
    minWidth: 90,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  discountField: { borderColor: "#FCA5A5", backgroundColor: "#FEF2F2" },
  discountMinus: { color: "#DC2626", fontWeight: "800", marginRight: 2 },
  inlineEditText: {
    fontSize: 14,
    color: "#0F172A",
    fontWeight: "600",
    padding: 0,
    textAlign: "right",
  },

  billDivider: { height: 1, backgroundColor: "#E2E8F0", marginVertical: 6 },
  billDividerDashed: {
    borderStyle: "dashed",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    marginVertical: 10,
  },
  grandTotalLabel: { fontSize: 15, fontWeight: "800", color: "#111827" },
  grandTotalValue: { fontSize: 20, fontWeight: "900", color: "#001B45" },

  /* ---------- Bill summary recap panel ---------- */
  recapCard: {
    backgroundColor: "#F8FAFC",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 14,
    marginTop: 14,
  },
  recapHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
    paddingVertical: 4,
  },
  recapTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#64748B",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  recapRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  recapLabel: { fontSize: 13, color: "#475569" },
  recapLabelBold: { fontWeight: "800", color: "#111827" },
  recapValue: { fontSize: 13, color: "#334155", fontWeight: "600" },
  recapValueBold: { fontSize: 15, fontWeight: "900", color: "#001B45" },
  recapValueNegative: { color: "#DC2626" },
  recapDivider: {
    height: 1,
    backgroundColor: "#E2E8F0",
    marginVertical: 6,
  },

  skeletonLine: {
    height: 14,
    borderRadius: 6,
    backgroundColor: "#E2E8F0",
    marginVertical: 6,
  },

  /* ---------- Payment mode selector ---------- */
  paymentTypeRow: { flexDirection: "row", gap: 10 },
  paymentTypeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "white",
  },
  paymentTypeBtnActive: { backgroundColor: "#FFF7D6", borderColor: "#FFC107" },
  paymentTypeText: { fontSize: 14, fontWeight: "600", color: "#64748B" },
  paymentTypeTextActive: { color: "#111827", fontWeight: "800" },

  phonePeSection: { marginTop: 14 },
  phonePeHint: {
    fontSize: 12,
    color: "#64748B",
    marginTop: -2,
    marginBottom: 10,
    lineHeight: 16,
  },
  phonePeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  phonePeIndexBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
  },
  phonePeIndexText: { fontSize: 12, fontWeight: "800", color: "#1D4ED8" },
  phonePeInputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "white",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    borderRadius: 10,
    paddingHorizontal: 14,
    height: 46,
  },
  phonePeInputWrapValid: { borderColor: "#86EFAC", backgroundColor: "#F0FDF4" },
  phonePeInputWrapPartial: {
    borderColor: "#FCA5A5",
    backgroundColor: "#FEF2F2",
  },
  phonePeInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 6,
    color: "#0F172A",
    padding: 0,
  },
  phonePeCounter: {
    fontSize: 11,
    fontWeight: "700",
    color: "#DC2626",
    marginLeft: 6,
  },
  phonePeRemoveBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FEF2F2",
  },
  phonePeAddBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingVertical: 6,
    marginTop: 2,
  },
  phonePeAddText: { fontSize: 13.5, fontWeight: "700", color: "#2563EB" },

  /* ---------- Refund section (NEW) ---------- */
  refundSection: {
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  refundHeaderRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  refundTitle: { fontSize: 15, fontWeight: "800", color: "#991B1B" },
  refundHint: {
    fontSize: 12,
    color: "#7F1D1D",
    marginTop: 4,
    marginBottom: 10,
    lineHeight: 16,
  },
  refundInput: { borderColor: "#FCA5A5", borderWidth: 1.5 },
  refundCurrency: {
    fontSize: 14,
    fontWeight: "700",
    color: "#B91C1C",
    marginRight: 4,
  },
  refundFullBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#FEE2E2",
  },
  refundFullText: { fontSize: 12, fontWeight: "800", color: "#B91C1C" },

  calculationBanner: {
    backgroundColor: "#F8FAFC",
    borderColor: "#E2E8F0",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 14,
  },
  alertBanner: { backgroundColor: "#FFFBEB", borderColor: "#FDE68A" },
  settledBanner: { backgroundColor: "#F0FDF4", borderColor: "#BBF7D0" },
  creditBanner: { backgroundColor: "#FEF2F2", borderColor: "#FECACA" },
  bannerLabel: { fontSize: 13, fontWeight: "700", color: "#334155" },
  bannerValue: { fontSize: 16, fontWeight: "800", color: "#0F172A" },

  actionRowGrid: { flexDirection: "row", gap: 10, marginTop: 24 },
  backCancelButton: {
    flex: 1,
    height: 52,
    borderWidth: 1.5,
    borderColor: "#002B6B",
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "white",
  },
  backButtonText: { color: "#002B6B", fontSize: 15, fontWeight: "700" },
  saveSubmitButton: {
    flex: 1,
    height: 52,
    borderRadius: 12,
    backgroundColor: "#FFC107",
    justifyContent: "center",
    alignItems: "center",
  },
  saveButtonText: { color: "#111827", fontSize: 15, fontWeight: "800" },
});

const modalStyles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    backgroundColor: "#FFF",
  },
  headerTitle: { fontSize: 20, fontWeight: "800", color: "#111827" },
  searchWrap: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#FFF",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 52,
  },
  searchInput: { flex: 1, marginLeft: 10, fontSize: 15, color: "#111827" },
  vehicleCard: {
    backgroundColor: "#FFF",
    marginHorizontal: 16,
    marginTop: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  vehicleIconWrap: {
    width: 50,
    height: 50,
    borderRadius: 12,
    backgroundColor: "#EFF6FF",
    justifyContent: "center",
    alignItems: "center",
  },
  vehicleName: { fontSize: 16, fontWeight: "700", color: "#111827" },
  vehicleNumber: { color: "#64748B", marginTop: 4 },
  vehicleColor: { color: "#94A3B8", marginTop: 2 },
  vehiclePrice: {
    color: "#16A34A",
    marginTop: 4,
    fontSize: 13,
    fontWeight: "700",
  },
  emptyText: { marginTop: 12, fontSize: 16, fontWeight: "700" },
});

// hanver get api
export const getHandovers = async (req, res) => {
  try {
    const { tab = "all" } = req.query;

    // No company filter
    const query = {
      isDeleted: false,
    };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    // IMPORTANT: "today" / "yesterday" describe when the handover
    // record was CREATED (createdAt), not the trip's pickupDateTime.
    // A handover created today can have a pickup scheduled for any
    // date, so filtering by pickupDateTime hid same-day entries.
    switch (tab) {
      case "today":
        query.createdAt = {
          $gte: today,
          $lt: tomorrow,
        };
        break;

      case "yesterday":
        query.createdAt = {
          $gte: yesterday,
          $lt: today,
        };
        break;

      case "draft":
        query.bookingStatus = "draft";
        break;

      default:
        break;
    }

    const handovers = await Handover.find(query)
      .populate("createdBy", "fullName email")
      .populate("company", "fullName companyName businessName")
      .populate("vehicle.vehicleId", "vehicleName vehicleNumber color status")
      .select(
        `
        company
        customer
        vehicle
        trip
        payment
        bookingStatus
        handoverStatus
        hasUploadedImages
        notes
        createdAt
        updatedAt
        createdBy
      `,
      )
      .sort({
        createdAt: -1,
      })
      .lean();

    const data = handovers.map((item) => ({
      _id: item._id,

      companyName:
        item.company?.businessName ||
        item.company?.companyName ||
        item.company?.fullName ||
        "",

      customerName: item.customer?.fullName || "",
      mobileNumber: item.customer?.mobileNumber || "",
      destination: item.customer?.destination || "",

      vehicleName: item.vehicle?.vehicleName || "",
      vehicleNumber: item.vehicle?.vehicleNumber || "",
      vehicleColor: item.vehicle?.vehicleColor || "",

      pickupDateTime: item.trip?.pickupDateTime,
      dropDateTime: item.trip?.dropDateTime,
      tripType: item.trip?.tripType,
      numberOfDays: item.trip?.numberOfDays,

      totalFare:
        item.payment?.billSummary?.totalFare ?? item.payment?.totalFare ?? 0,
      totalAmount:
        item.payment?.billSummary?.totalAmount ??
        item.payment?.totalAmount ??
        0,
      // NEW — balance now reads from the billSummary ledger (falls back to
      // payment.balanceAmount only for older records saved before
      // billSummary existed, so nothing breaks for historic data)
      balanceAmount:
        item.payment?.billSummary?.balanceAmount ??
        item.payment?.balanceAmount ??
        0,
      totalCollected: item.payment?.billSummary?.totalCollected ?? 0,
      paymentStatus: item.payment?.paymentStatus || "pending",

      bookingStatus: item.bookingStatus,
      handoverStatus: item.handoverStatus,
      hasUploadedImages: item.hasUploadedImages || false,

      notes: item.notes || "",

      createdBy: item.createdBy?.fullName || "",

      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));

    return res.status(200).json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    console.error("Get Handovers Error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch handovers.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
// NOT USED
export const getAllHandovers = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const filters = {
      company: req.user.company || req.user._id,
      isDeleted: false,
    };

    // optional filters
    if (req.query.bookingStatus) {
      filters.bookingStatus = req.query.bookingStatus;
    }

    if (req.query.handoverStatus) {
      filters.handoverStatus = req.query.handoverStatus;
    }

    if (req.query.paymentStatus) {
      filters["payment.paymentStatus"] = req.query.paymentStatus;
    }

    // search
    if (req.query.search) {
      filters.$or = [
        {
          "customer.fullName": {
            $regex: req.query.search,
            $options: "i",
          },
        },
        {
          "customer.mobileNumber": {
            $regex: req.query.search,
            $options: "i",
          },
        },
        {
          "vehicle.vehicleNumber": {
            $regex: req.query.search,
            $options: "i",
          },
        },
        {
          "vehicle.vehicleName": {
            $regex: req.query.search,
            $options: "i",
          },
        },
      ];
    }

    const [handovers, total] = await Promise.all([
      Handover.find(filters)
        .populate("createdBy", "fullName email role")
        .populate("vehicle.vehicleId", "name number color type")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      Handover.countDocuments(filters),
    ]);

    res.status(200).json({
      success: true,
      message: "Handovers fetched successfully",
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      data: handovers,
    });
  } catch (error) {
    next(error);
  }
};

export const updateHandover = async (req, res, next) => {
  try {
    const handover = await Handover.findOne({
      _id: req.params.id,
      isDeleted: false,
    });

    if (!handover) {
      return res.status(404).json({
        success: false,
        message: "Handover not found",
      });
    }

    Object.assign(handover, req.body);

    await handover.save();

    res.status(200).json({
      success: true,
      message: "Handover updated successfully",
      data: handover,
    });
  } catch (error) {
    console.log("========== CLOUDINARY ERROR ==========");
    console.log(error);
    console.log("MESSAGE:", error.message);
    console.log("STACK:", error.stack);

    return res.status(500).json({
      success: false,
      message: error.message,
      fullError: error,
    });
  }
};

export const deleteHandover = async (req, res, next) => {
  try {
    const handover = await Handover.findOne({
      _id: req.params.id,
    });

    if (!handover) {
      return res.status(404).json({
        success: false,
        message: "Handover not found",
      });
    }

    handover.isDeleted = true;

    await handover.save();

    res.status(200).json({
      success: true,
      message: "Handover deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

export const discardHandoverDraft = async (req, res) => {
  try {
    const { id } = req.params;

    const handover = await Handover.findOne({ _id: id, isDeleted: false });

    if (!handover) {
      return res.status(404).json({
        success: false,
        message: "Handover not found.",
      });
    }

    if (handover.bookingStatus !== "draft") {
      return res.status(400).json({
        success: false,
        message: "Only draft handovers can be discarded.",
      });
    }

    handover.bookingStatus = "cancelled";
    handover.isDeleted = true;

    await handover.save();

    return res.status(200).json({
      success: true,
      message: "Draft discarded successfully.",
      data: { _id: handover._id, bookingStatus: handover.bookingStatus },
    });
  } catch (error) {
    console.error("Discard Handover Draft Error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to discard draft.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
