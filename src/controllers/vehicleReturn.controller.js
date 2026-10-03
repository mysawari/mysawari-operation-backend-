import Handover from "../models/handover.model.js";
import Vehicle from "../models/vehicle.model.js";
import VehicleReturn from "../models/vehicleReturn.model.js";
import Booking from "../models/booking.model.js";
import PaymentHistory from "../models/paymentHistory.model.js";


const RETURN_IMAGE_FIELDS = {
  car: {
    // Matches the app: car needs exterior + all tyres + spare + toolkit.
    required: [
      "vehicleFront",
      "vehicleRear",
      "vehicleLeft",
      "vehicleRight",
      "tyreFrontLeft",
      "tyreFrontRight",
      "tyreRearLeft",
      "tyreRearRight",
      "spareTyre",
      "toolkit",
    ],
    optional: [],
  },
  bike: {
    required: ["vehicleFront", "vehicleRear", "vehicleLeft", "vehicleRight"],
    optional: ["tyreFront", "tyreRear", "helmet", "toolkit"],
  },
};
 
// Fields that hold a list of photos, with the max count for each.
const MULTI_IMAGE_FIELDS = {
  damageImages: 20,
  additionalImages: 20,
};
 
const ALL_IMAGE_FIELDS = new Set([
  ...Object.values(RETURN_IMAGE_FIELDS).flatMap((f) => [
    ...f.required,
    ...f.optional,
  ]),
  ...Object.keys(MULTI_IMAGE_FIELDS),
]);
 
export const getVehicleCategory = (vehicle) => {
  const category = String(vehicle?.category || "")
    .toLowerCase()
    .trim();
  return category === "bike" ? "bike" : "car";
};
 
const isAllowedImageField = (category, field) => {
  const fields = RETURN_IMAGE_FIELDS[category] || RETURN_IMAGE_FIELDS.car;
  return (
    fields.required.includes(field) ||
    fields.optional.includes(field) ||
    Boolean(MULTI_IMAGE_FIELDS[field])
  );
};
 
/* ==========================================================
   Every return photo for a handover lives in its own folder,
   so the server can verify a submitted photo really was
   uploaded through our API for THIS handover.
========================================================== */
 
 
/**
 * Checks a { url, publicId } pair sent by the app:
 * - publicId is inside this handover's folder
 * - url is an https Cloudinary URL pointing at that publicId
 * Returns the clean pair, or null if it isn't valid.
 */
const parseOwnReturnImage = (img, handoverId) => {
  if (!img || typeof img !== "object") return null;
 
  const url = typeof img.url === "string" ? img.url.trim() : "";
  const publicId = typeof img.publicId === "string" ? img.publicId.trim() : "";
 
  if (!url || !publicId) return null;
  if (!publicId.startsWith(`${returnImageFolder(handoverId)}/`)) return null;
 
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    if (parsed.hostname !== "res.cloudinary.com") return null;
    if (!parsed.pathname.includes(`/${publicId}`)) return null;
  } catch {
    return null;
  }
 
  return { url, publicId };
};
 
/**
 * Best-effort delete of Cloudinary images. Never throws, so callers can
 * fire-and-forget it without risking the main request.
 */
const destroyCloudinaryImages = (publicIds = []) => {
  const ids = [...new Set((publicIds || []).filter(Boolean))];
  return Promise.allSettled(
    ids.map((id) =>
      cloudinary.uploader
        .destroy(id, { resource_type: "image" })
        .catch((err) =>
          console.error("CLOUDINARY DESTROY ERROR:", id, err?.message),
        ),
    ),
  );
};
 
const fail = (res, status, message, extra = {}) =>
  res.status(status).json({ success: false, message, ...extra });
 
/* ==========================================================
   MIDDLEWARE: validate handover + field BEFORE the file is
   uploaded, so bad requests never reach Cloudinary.
========================================================== */
 
export const validateReturnImageRequest = async (req, res, next) => {
  try {
    const { handoverId, field } = req.params;
 
    if (!mongoose.isValidObjectId(handoverId)) {
      return fail(res, 400, "Invalid handover id");
    }
 
    if (!ALL_IMAGE_FIELDS.has(field)) {
      return fail(res, 400, `Unknown photo field "${field}"`);
    }
 
    const handover = await Handover.findById(handoverId)
      .select("company vehicle handoverStatus")
      .lean();
 
    if (!handover) return fail(res, 404, "Handover not found");
 
    // Once returned, its photos belong to the VehicleReturn record and
    // must not be changed or deleted through this API.
    if (handover.handoverStatus === "returned") {
      return fail(res, 409, "Vehicle already received");
    }
 
    // TODO (recommended): check the handover belongs to req.user's
    // company, the same way your other routes do.
 
    const vehicleId = handover.vehicle?.vehicleId || handover.vehicle;
    const vehicle = await Vehicle.findById(vehicleId).select("category").lean();
 
    if (!vehicle) return fail(res, 404, "Vehicle not found");
 
    const vehicleCategory = getVehicleCategory(vehicle);
 
    if (!isAllowedImageField(vehicleCategory, field)) {
      return fail(
        res,
        400,
        `"${field}" is not a valid photo for a ${vehicleCategory}`,
      );
    }
 
    req.returnCtx = { handover, vehicleCategory };
    return next();
  } catch (error) {
    console.error("VALIDATE RETURN IMAGE ERROR:", error);
    return fail(res, 500, "Unable to validate photo upload");
  }
};
 
/* ==========================================================
   POST /vehicle-return/images/:handoverId/:field
   multipart: image=<file>
 
   By the time this runs, multer-storage-cloudinary has already
   uploaded the file. We just return its URL + publicId.
   The app keeps them and sends them with the final submit.
 
   Response 201:
   { success, data: { field, url, publicId } }
========================================================== */
 
export const uploadReturnImage = (req, res) => {
  const file = req.file;
 
  if (!file?.path) {
    return fail(res, 400, 'No image received. Send the photo as "image".');
  }
 
  return res.status(201).json({
    success: true,
    message: "Photo uploaded",
    data: {
      field: req.params.field,
      url: file.path, // multer-storage-cloudinary: secure URL
      publicId: file.filename, // multer-storage-cloudinary: public_id
    },
  });
};
 
/* ==========================================================
   DELETE /vehicle-return/images/:handoverId/:field?publicId=...
 
   Called by the app when a photo is retaken or removed, so the old
   file doesn't stay on Cloudinary. Only files inside this handover's
   folder can be deleted. Idempotent.
========================================================== */
 
export const deleteReturnImage = async (req, res) => {
  const { handoverId } = req.params;
  const publicId = String(req.query.publicId || "").trim();
 
  if (!publicId) return fail(res, 400, "publicId is required");
 
  if (!publicId.startsWith(`${returnImageFolder(handoverId)}/`)) {
    return fail(res, 403, "This photo does not belong to this handover");
  }
 
  try {
    await destroyCloudinaryImages([publicId]);
    return res.status(200).json({ success: true, message: "Photo removed" });
  } catch (error) {
    console.error("DELETE RETURN IMAGE ERROR:", error);
    return fail(res, 500, "Unable to remove photo");
  }
};
 
// Body values may arrive as objects (JSON) or JSON strings.
const parseMaybeJson = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined; // signals "invalid"
  }
};

export const receiveVehicle = async (req, res) => {
  try {
    const { handoverId } = req.params;
 
    const {
      fuelLevel,
      kilometersAtReturn,
      hasDamage,
      damageNotes,
      inspection,
 
      repairEstimate,
      repairDays,
 
      lateReturnFine,
      extraKmFine,
      fuelUsageAmount,
      amountCollected,
      paymentMode,
      paymentBreakdown, // object (JSON body) or JSON string
      balanceReason,
      upiLast4,
 
      needsMaintenance,
      maintenanceReason,
      maintenanceDays,
 
      images,
      damageImages: damageImagesInput,
      additionalImages: additionalImagesInput,
    } = req.body || {};
 
    /* ==========================
       BASIC VALIDATION
    ========================== */
 
    const isBlank = (v) => v === undefined || v === null || v === "";
 
    if (isBlank(fuelLevel) || isBlank(kilometersAtReturn)) {
      return res.status(400).json({
        success: false,
        message: "Fuel level and kilometers at return are required",
      });
    }
 
    const fuelLevelNum = Number(fuelLevel);
    const kmNum = Number(kilometersAtReturn);
 
    if (!Number.isFinite(fuelLevelNum) || fuelLevelNum < 0 || fuelLevelNum > 7) {
      return res.status(400).json({
        success: false,
        message: "Fuel level must be between 0 and 7",
      });
    }
 
    if (!Number.isFinite(kmNum) || kmNum < 0) {
      return res.status(400).json({
        success: false,
        message: "Kilometers at return must be a valid number",
      });
    }
 
    /* ==========================
       FIND HANDOVER
    ========================== */
    const handover = await Handover.findById(handoverId);
 
    if (!handover) {
      return res
        .status(404)
        .json({ success: false, message: "Handover not found" });
    }
 
    const companyId = handover.company;
 
    if (handover.handoverStatus === "returned") {
      return res.status(400).json({
        success: false,
        message: "Vehicle already received",
      });
    }
 
    /* ==========================
       FIND VEHICLE
    ========================== */
 
    const vehicleId = handover.vehicle?.vehicleId || handover.vehicle;
 
    const vehicle = await Vehicle.findById(vehicleId);
 
    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: "Vehicle not found",
      });
    }
 
    if (vehicle.status !== "rent") {
      return res.status(400).json({
        success: false,
        message: "Vehicle is not currently on rent",
      });
    }
 
    /* ==========================
       EXISTING RETURN CHECK
    ========================== */
 
    const existingReturn = await VehicleReturn.findOne({
      handover: handoverId,
    });
 
    if (existingReturn) {
      return res.status(400).json({
        success: false,
        message: "Return already submitted",
      });
    }
 
    /* ==========================
       CAR / BIKE + PHOTOS
       Category is read from Vehicle.category in the DB, not trusted
       from the app.
    ========================== */
 
    const vehicleCategory = getVehicleCategory(vehicle);
    const imageFields = RETURN_IMAGE_FIELDS[vehicleCategory];
 
    const parsedImages = parseMaybeJson(images, {});
    const parsedDamageInput = parseMaybeJson(damageImagesInput, []);
    const parsedAdditionalInput = parseMaybeJson(additionalImagesInput, []);
 
    if (
      !parsedImages ||
      typeof parsedImages !== "object" ||
      Array.isArray(parsedImages) ||
      !Array.isArray(parsedDamageInput) ||
      !Array.isArray(parsedAdditionalInput)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid photo data format",
      });
    }
 
    // Single-slot photos (only fields valid for this category)
    const verifiedImages = {};
    const invalidImages = [];
 
    [...imageFields.required, ...imageFields.optional].forEach((key) => {
      if (!parsedImages[key]) return;
      const verified = parseOwnReturnImage(parsedImages[key], handover._id);
      if (verified) verifiedImages[key] = verified;
      else invalidImages.push(key);
    });
 
    // List photos
    const verifyList = (list, field) => {
      if (list.length > MULTI_IMAGE_FIELDS[field]) {
        invalidImages.push(`${field} (max ${MULTI_IMAGE_FIELDS[field]})`);
        return [];
      }
      return list
        .map((img, index) => {
          const verified = parseOwnReturnImage(img, handover._id);
          if (!verified) invalidImages.push(`${field}[${index}]`);
          return verified;
        })
        .filter(Boolean);
    };
 
    const verifiedDamage = verifyList(parsedDamageInput, "damageImages");
    const verifiedAdditional = verifyList(
      parsedAdditionalInput,
      "additionalImages",
    );
 
    if (invalidImages.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Some photos are invalid. Please retake them.",
        invalidImages,
      });
    }
 
    const missingImages = imageFields.required.filter(
      (key) => !verifiedImages[key],
    );
 
    if (missingImages.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Some required photos are missing. Please check the photo screen.",
        missingImages,
      });
    }
 
    /* ==========================
       INSPECTION PARSE
    ========================== */
 
    let parsedInspection = [];
 
    try {
      if (inspection) {
        parsedInspection =
          typeof inspection === "string" ? JSON.parse(inspection) : inspection;
      }
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid inspection data format",
      });
    }
 
    if (!Array.isArray(parsedInspection)) {
      return res.status(400).json({
        success: false,
        message: "Invalid inspection data format",
      });
    }
 
    const ALLOWED_CONDITIONS = ["good", "minor", "major"];
    parsedInspection = parsedInspection.map((row) => ({
      itemName: String(row?.itemName || "").trim(),
      condition: String(row?.condition || "").toLowerCase(),
      note: String(row?.note || "").trim(),
    }));
 
    const badInspectionRow = parsedInspection.find(
      (row) => !row.itemName || !ALLOWED_CONDITIONS.includes(row.condition),
    );
 
    if (badInspectionRow) {
      return res.status(400).json({
        success: false,
        message: `Inspection item "${
          badInspectionRow.itemName || "unknown"
        }" is missing a valid condition`,
      });
    }
 
    /* ==========================
       PAYMENT BREAKDOWN PARSE
    ========================== */
 
    let parsedPaymentBreakdown = { cash: 0, phonePe: 0, razorpay: 0 };
 
    try {
      if (paymentBreakdown) {
        const raw =
          typeof paymentBreakdown === "string"
            ? JSON.parse(paymentBreakdown)
            : paymentBreakdown;
 
        parsedPaymentBreakdown = {
          cash: Number(raw?.cash) || 0,
          phonePe: Number(raw?.phonePe) || 0,
          razorpay: Number(raw?.razorpay) || 0,
        };
      }
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment breakdown format",
      });
    }
 
    const ALLOWED_PAYMENT_MODES = ["Cash", "PhonePe", "Razorpay", "Mixed"];
    const normalizedPaymentMode = ALLOWED_PAYMENT_MODES.includes(paymentMode)
      ? paymentMode
      : "Cash";
 
    let normalizedUpiLast4 = [];
 
    try {
      normalizedUpiLast4 =
        typeof upiLast4 === "string" ? JSON.parse(upiLast4) : upiLast4;
 
      if (!Array.isArray(normalizedUpiLast4)) {
        normalizedUpiLast4 = [];
      }
 
      normalizedUpiLast4 = normalizedUpiLast4
        .map((value) => String(value).trim())
        .filter(Boolean);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid UPI last 4 digits format",
      });
    }
 
    const isUpiPayment =
      normalizedPaymentMode === "PhonePe" ||
      (normalizedPaymentMode === "Mixed" && parsedPaymentBreakdown.phonePe > 0);
 
    if (
      isUpiPayment &&
      (normalizedUpiLast4.length === 0 ||
        normalizedUpiLast4.some((value) => !/^\d{4}$/.test(value)))
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide valid UPI last 4 digits",
      });
    }
 
    if (normalizedPaymentMode !== "Mixed" && !paymentBreakdown) {
      const singleAmount = Number(amountCollected) || 0;
      parsedPaymentBreakdown = {
        cash: normalizedPaymentMode === "Cash" ? singleAmount : 0,
        phonePe: normalizedPaymentMode === "PhonePe" ? singleAmount : 0,
        razorpay: normalizedPaymentMode === "Razorpay" ? singleAmount : 0,
      };
    }
 
    /* ==========================
       DAMAGE DATA
    ========================== */
 
    const isDamaged = hasDamage === true || hasDamage === "true";
 
    const damageImages = isDamaged ? verifiedDamage.map((img) => img.url) : [];
 
    if (isDamaged && damageImages.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Damage images are required when damage is reported",
      });
    }
 
    /* ==========================
       ADDITIONAL IMAGES (optional)
    ========================== */
 
    const additionalImages = verifiedAdditional.map((img) => img.url);
 
    /* ==========================
       RETURN IMAGES
       Only fields that belong to this vehicle's category are stored.
    ========================== */
 
    const returnImages = {};
    [...imageFields.required, ...imageFields.optional].forEach((key) => {
      returnImages[key] = verifiedImages[key]?.url || "";
    });
 
    /* ==========================
       MAINTENANCE
    ========================== */
 
    const maintenanceRequired =
      needsMaintenance === true ||
      needsMaintenance === "true" ||
      needsMaintenance === "yes";
 
    if (maintenanceRequired && !String(maintenanceReason || "").trim()) {
      return res.status(400).json({
        success: false,
        message: "Maintenance reason is required",
      });
    }
 
    if (
      maintenanceRequired &&
      (!maintenanceDays || Number(maintenanceDays) <= 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "Maintenance days are required",
      });
    }
 
    const estimate = isDamaged ? Number(repairEstimate) || 0 : 0;
 
    const repairDuration = isDamaged ? Number(repairDays) || 0 : 0;
 
    /* ==========================
       SETTLEMENT CALCULATIONS
    ========================== */
 
    const pendingAmount =
      Number(handover.payment?.billSummary?.balanceAmount) || 0;
 
    const lateFine = Number(lateReturnFine) || 0;
 
    const kmFine = Number(extraKmFine) || 0;
 
    const fuelFine = Number(fuelUsageAmount) || 0;
 
    const collected = Number(amountCollected) || 0;
 
    if ([lateFine, kmFine, fuelFine, estimate, collected].some((n) => n < 0)) {
      return res.status(400).json({
        success: false,
        message: "Amounts cannot be negative",
      });
    }
 
    const totalBalanceAmount =
      pendingAmount + lateFine + kmFine + fuelFine + estimate;
 
    const finalBalance = Math.max(totalBalanceAmount - collected, 0);
 
    /* ==========================
       VALIDATE REASON
    ========================== */
 
    if (finalBalance > 0 && !String(balanceReason || "").trim()) {
      return res.status(400).json({
        success: false,
        message: "Reason is required when full amount is not collected",
      });
    }
 
    if (collected > totalBalanceAmount) {
      return res.status(400).json({
        success: false,
        message: "Received amount cannot exceed total balance",
      });
    }
 
    if (normalizedPaymentMode === "Mixed") {
      const mixedTotal =
        parsedPaymentBreakdown.cash +
        parsedPaymentBreakdown.phonePe +
        parsedPaymentBreakdown.razorpay;
 
      if (mixedTotal <= 0) {
        return res.status(400).json({
          success: false,
          message: "Please provide mixed payment amounts",
        });
      }
 
      if (Math.round(mixedTotal) !== Math.round(collected)) {
        return res.status(400).json({
          success: false,
          message:
            "Payment breakdown total does not match the amount collected",
        });
      }
    }
 
    /* ==========================
       SETTLEMENT STATUS
    ========================== */
 
    let settlementStatus = "Pending Collection";
 
    if (totalBalanceAmount === 0 || collected >= totalBalanceAmount) {
      settlementStatus = "Collected";
    } else if (collected > 0) {
      settlementStatus = "Partially Collected";
    }
 
    /* ==========================
       TIME CALCULATIONS
    ========================== */
 
    const actualReceivingTime = new Date();
 
    const scheduledReturnTime = new Date(handover.trip.dropDateTime);
 
    const diffMs = actualReceivingTime - scheduledReturnTime;
 
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
 
    let timeStatus = "On Time";
    let delayInMinutes = 0;
    let delayText = "0 minutes";
 
    if (diffMinutes > 15) {
      timeStatus = "Delayed";
 
      delayInMinutes = diffMinutes;
 
      const days = Math.floor(delayInMinutes / (24 * 60));
 
      const hours = Math.floor((delayInMinutes % (24 * 60)) / 60);
 
      const mins = delayInMinutes % 60;
 
      delayText =
        `${days > 0 ? `${days}d ` : ""}` +
        `${hours > 0 ? `${hours}h ` : ""}` +
        `${mins}m`;
    } else if (diffMinutes < -15) {
      timeStatus = "Before Time";
 
      delayText = "Received Early";
    }
 
    /* ==========================
       CREATE RETURN
    ========================== */
 
    const maintenanceDaysNum = Number(maintenanceDays) || 0;
 
    const vehicleReturn = await VehicleReturn.create({
      company: companyId,
      createdBy: req.user._id,
      receivedBy: req.user._id,
      receivingTime: actualReceivingTime,
      scheduledReturnTime,
      timeStatus,
      delayInMinutes,
      delayText,
      handover: handover._id,
      vehicle: vehicle._id,
      vehicleCategory,
      customerName: handover.customer?.fullName || "",
      fuelLevel: fuelLevelNum,
      kilometersAtReturn: kmNum,
      hasDamage: isDamaged,
      damageNotes: isDamaged ? damageNotes || "" : "",
      inspection: parsedInspection,
 
      maintenanceDetails: {
        required: maintenanceRequired,
        reason: maintenanceRequired ? maintenanceReason || "" : "",
        estimatedDays: maintenanceRequired ? maintenanceDaysNum : 0,
        estimatedCompletionDate: maintenanceRequired
          ? new Date(Date.now() + maintenanceDaysNum * 24 * 60 * 60 * 1000)
          : null,
      },
 
      images: returnImages,
      damageImages,
      additionalImages,
 
      damageCostDetails: isDamaged
        ? {
            repairEstimate: estimate,
            repairDays: repairDuration,
            actualRepairCost: 0,
            repairedAt: null,
            remarks: "",
            status: "Pending",
          }
        : undefined,
 
      settlementDetails: {
        pendingAmount,
        lateReturnFine: lateFine,
        extraKmFine: kmFine,
        fuelUsageAmount: fuelFine,
        damageAmount: estimate,
        totalBalanceAmount,
        amountCollected: collected,
        paymentMode: normalizedPaymentMode,
        paymentBreakdown: parsedPaymentBreakdown,
        upiLast4: isUpiPayment ? normalizedUpiLast4 : [],
        finalBalance,
        balanceReason: balanceReason || "",
        status: settlementStatus,
        settledAt: new Date(),
      },
 
      returnStatus: "completed",
    });
 
    // Damage photos sent while damage is "No" are not stored, so remove
    // them from Cloudinary instead of leaving orphans.
    if (!isDamaged && verifiedDamage.length > 0) {
      destroyCloudinaryImages(verifiedDamage.map((img) => img.publicId));
    }
 
    /* ==========================================================
       PAYMENT HISTORY
    ========================================================== */
 
    if (collected > 0) {
      try {
        const finalPaymentMethod = (() => {
          const mode = String(normalizedPaymentMode || "Cash").toLowerCase();
 
          const paymentMethodMap = {
            cash: "cash",
            phonepe: "phonepe",
            razorpay: "razorpay",
            mixed: "mixed",
          };
 
          return paymentMethodMap[mode] || "cash";
        })();
 
        const paymentHistory = await PaymentHistory.create({
          company: companyId,
          bookingId: handover.bookingId || null,
          handoverId: handover._id,
 
          customer: {
            fullName: handover.customer?.fullName || "",
            mobileNumber: handover.customer?.mobileNumber || "",
          },
 
          vehicle: {
            vehicleId: vehicle._id,
            vehicleName: vehicle.vehicleName || "",
            vehicleNumber: vehicle.vehicleNumber || "",
          },
 
          booking: {
            fromDate: handover.trip?.pickupDateTime || null,
            toDate: handover.trip?.dropDateTime || null,
            bookingAmount: Number(handover.payment?.totalAmount) || 0,
          },
 
          amount: collected,
          paymentMethod: finalPaymentMethod,
          upiLast4: isUpiPayment ? normalizedUpiLast4 : [],
 
          paymentBreakdown: {
            cash: Number(parsedPaymentBreakdown?.cash) || 0,
            phonePe: Number(parsedPaymentBreakdown?.phonePe) || 0,
            razorpay: Number(parsedPaymentBreakdown?.razorpay) || 0,
          },
 
          type: "receive",
 
          note:
            String(balanceReason || "").trim() ||
            "Payment received during vehicle return",
 
          createdBy: req.user?._id || null,
        });
 
        if (vehicle?._id && paymentHistory?._id) {
          await Vehicle.findByIdAndUpdate(vehicle._id, {
            $push: { payments: paymentHistory._id },
          });
        }
      } catch (paymentHistoryError) {
        console.error(
          "RECEIVE PAYMENT HISTORY CREATION ERROR:",
          paymentHistoryError?.message,
        );
      }
    }
 
    /* ==========================
       UPDATE VEHICLE
    ========================== */
 
    if (maintenanceRequired) {
      const completionDate = new Date();
 
      completionDate.setDate(completionDate.getDate() + maintenanceDaysNum);
 
      vehicle.status = "service";
 
      vehicle.maintenance = {
        required: true,
        reason: maintenanceReason || "",
        estimatedDays: maintenanceDaysNum,
        estimatedCompletionDate: completionDate,
        markedBy: req.user._id,
        markedAt: new Date(),
      };
    } else {
      vehicle.status = "available";
 
      vehicle.maintenance = {
        required: false,
        reason: "",
        estimatedDays: 0,
        estimatedCompletionDate: null,
        markedBy: null,
        markedAt: null,
      };
    }
 
    await vehicle.save();
 
    /* ==========================
       UPDATE HANDOVER
    ========================== */
 
    handover.handoverStatus = "returned";
 
    handover.returnDetails = {
      returnedAt: new Date(),
      returnedBy: req.user._id,
      remarks: balanceReason || "",
    };
 
    handover.payment.balanceAmount = finalBalance;
 
    if (finalBalance === 0) {
      handover.payment.paymentStatus = "paid";
    } else if (collected > 0) {
      handover.payment.paymentStatus = "partial";
    } else {
      handover.payment.paymentStatus = "pending";
    }
 
    const existingBill = handover.payment.billSummary || {};
 
    const returnTimeExtras = lateFine + kmFine + fuelFine + estimate;
 
    handover.payment.billSummary = {
      ...existingBill,
      extraCharges: Number(existingBill.extraCharges || 0) + returnTimeExtras,
      totalAmount: Number(existingBill.totalAmount || 0) + returnTimeExtras,
      amountReceivedNow:
        Number(existingBill.amountReceivedNow || 0) + collected,
      totalCollected: Number(existingBill.totalCollected || 0) + collected,
      balanceAmount: finalBalance,
    };
 
    handover.markModified("payment.billSummary");
 
    await handover.save();
 
    /* ==========================
       UPDATE BOOKING
    ========================== */
 
    if (handover.bookingId) {
      const booking = await Booking.findByIdAndUpdate(
        handover.bookingId,
        {
          $set: {
            toDate: actualReceivingTime,
            status: "completed",
          },
        },
        {
          new: true,
          runValidators: true,
        },
      );
 
      if (!booking) {
        console.warn(`Booking not found: ${handover.bookingId}`);
      } else {
        // --- Referral Reward Logic (unchanged) ---
        try {
          const Referral = (await import("../models/referral.model.js"))
            .default;
          const Customer = (await import("../models/customer.model.js"))
            .default;
          const SawariCashTransaction = (
            await import("../models/sawaricash_transaction.model.js")
          ).default;
 
          const referral = await Referral.findOne({
            referredMobile: handover.customer.mobileNumber,
            status: { $ne: "rewarded" },
          });
 
          if (referral) {
            const commission = Math.round(
              (handover.payment.billSummary.totalAmount || 0) * 0.1,
            );
            if (commission > 0) {
              await Customer.findByIdAndUpdate(referral.referrerId, {
                $inc: { walletBalance: commission },
              });
 
              await SawariCashTransaction.create({
                customerId: referral.referrerId,
                amount: commission,
                transactionType: "credit",
                reason: "referral_commission",
                status: "completed",
                description: `10% commission from referred customer's successful ride`,
              });
 
              referral.status = "rewarded";
              referral.commissionAmount = commission;
              referral.rewardBookingId = booking._id;
              referral.rewardedAt = new Date();
              await referral.save();
            }
          }
        } catch (refError) {
          console.error("Referral Commission Error:", refError);
        }
      }
    }
 
    /* ==========================
       RESPONSE
    ========================== */
 
    return res.status(201).json({
      success: true,
      message:
        vehicleCategory === "bike"
          ? "Bike received successfully"
          : "Vehicle received successfully",
      data: vehicleReturn,
    });
  } catch (error) {
    console.error("RECEIVE VEHICLE ERROR:", error);
 
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

export const getServiceVehicles = async (req, res) => {
  try {
    const companyId = req.user.company || req.user._id;

    const vehicles = await Vehicle.find({
      company: companyId,
      isDeleted: false,
      status: "service",
    })
      .populate("maintenance.markedBy", "fullName role")
      .sort({
        "maintenance.markedAt": -1,
      });

    const data = vehicles.map((vehicle) => {
      const today = new Date();

      const completionDate = vehicle.maintenance?.estimatedCompletionDate;

      let remainingDays = 0;

      if (completionDate) {
        remainingDays = Math.ceil(
          (new Date(completionDate) - today) / (1000 * 60 * 60 * 24),
        );
      }

      return {
        _id: vehicle._id,

        vehicleName: vehicle.vehicleName,
        vehicleNumber: vehicle.vehicleNumber,
        manufacturer: vehicle.manufacturer,
        model: vehicle.model,
        variant: vehicle.variant,
        color: vehicle.color,

        vehicleType: vehicle.vehicleType,
        fuelType: vehicle.fuelType,
        transmission: vehicle.transmission,
        seatingCapacity: vehicle.seatingCapacity,

        status: vehicle.status,

        images: vehicle.images,

        maintenance: {
          required: vehicle.maintenance?.required || false,

          reason: vehicle.maintenance?.reason || "",

          estimatedDays: vehicle.maintenance?.estimatedDays || 0,

          estimatedCompletionDate: vehicle.maintenance?.estimatedCompletionDate,

          remainingDays,

          markedAt: vehicle.maintenance?.markedAt,

          markedBy: vehicle.maintenance?.markedBy
            ? {
                _id: vehicle.maintenance.markedBy._id,
                fullName: vehicle.maintenance.markedBy.fullName,
                role: vehicle.maintenance.markedBy.role,
              }
            : null,
        },
      };
    });

    return res.status(200).json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    console.error("GET SERVICE VEHICLES ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch service vehicles",
    });
  }
};
export const markVehicleAvailable = async (req, res) => {
  try {
    const { id } = req.params;

    const companyId = req.user.company || req.user._id;

    const vehicle = await Vehicle.findOne({
      _id: id,
      company: companyId,
      isDeleted: false,
    });

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: "Vehicle not found",
      });
    }

    vehicle.status = "available";

    vehicle.maintenance = {
      required: false,
      reason: "",
      estimatedDays: 0,
      estimatedCompletionDate: null,
      markedBy: null,
      markedAt: null,
    };

    await vehicle.save();

    return res.status(200).json({
      success: true,
      message: "Vehicle marked as available",
      data: vehicle,
    });
  } catch (error) {
    console.error("MARK AVAILABLE ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getReturnDetails = async (req, res) => {
  try {
    const { handoverId } = req.params;

    const vehicleReturn = await VehicleReturn.findOne({ handover: handoverId })
      // Vehicle info block on screen — exactly the fields InfoRow renders,
      // plus `images` (used by "Vehicle Catalog Photos").
      .populate({
        path: "vehicle",
        select:
          "vehicleName vehicleNumber manufacturer model variant color images",
      })
      // "Received By" row.
      .populate("receivedBy", "fullName role")
      // Handover: trimmed to just the three things the screen reads —
      // customer (for the Customer Information card), payment.billSummary
      // (for the Bill Details card), and createdAt (for the Timeline's
      // "Booking Created" entry). Everything else that used to be
      // populated here (bookingId, extensionBills, vehicleHistory,
      // returnDetails, handover.vehicle.vehicleId, company) isn't
      // referenced anywhere in the detail screen — populating them was
      // pure wasted work on every request.
      .populate({
        path: "handover",
        select: "customer payment.billSummary createdAt",
        populate: {
          path: "customer",
          select: "fullName mobileNumber",
        },
      })
      // .lean() — this response is read-only JSON going straight to the
      // client, so there's no need to pay for a full hydrated Mongoose
      // document with change-tracking, virtuals, etc.
      .lean();

    if (!vehicleReturn) {
      return res.status(404).json({
        success: false,
        message: "Return details not found for this handover",
      });
    }

    return res.status(200).json({
      success: true,
      data: vehicleReturn,
    });
  } catch (error) {
    console.error("GET RETURN DETAILS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

export const getVehicleReturnsDashboard = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 15, 1),
      50,
    );
    const tab = req.query.tab || "All"; // "All" | "Today" | "Yesterday" | "Due"

    const getISTDate = (date) =>
      new Date(date).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

    const now = new Date();
    const today = getISTDate(now);
    const yesterdayDate = new Date(now);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = getISTDate(yesterdayDate);

    // Real Date boundaries (not stringified comparisons) so Mongo can use
    // the createdAt index for a range match instead of loading every
    // document into Node just to compare dates in JS.
    const istStart = (dateStr) => new Date(`${dateStr}T00:00:00+05:30`);
    const todayStart = istStart(today);
    const yesterdayStart = istStart(yesterday);
    const tomorrowStart = new Date(todayStart.getTime() + 86400000);

    // Build the filter for the tab that's actually being viewed — we only
    // ever query the slice the user is looking at, never the whole table.
    const match = {};
    if (tab === "Today")
      match.createdAt = { $gte: todayStart, $lt: tomorrowStart };
    else if (tab === "Yesterday")
      match.createdAt = { $gte: yesterdayStart, $lt: todayStart };
    else if (tab === "Due") match.isDue = true;

    // ---- Stats: pure indexed counts, no document bodies fetched at all ----
    // These run in parallel and stay fast at any collection size because
    // they only touch indexes, never actual row data.
    const [total, todayCount, yesterdayCount, dueCount] = await Promise.all([
      VehicleReturn.countDocuments({}),
      VehicleReturn.countDocuments({
        createdAt: { $gte: todayStart, $lt: tomorrowStart },
      }),
      VehicleReturn.countDocuments({
        createdAt: { $gte: yesterdayStart, $lt: todayStart },
      }),
      VehicleReturn.countDocuments({ isDue: true }),
    ]);
    const stats = {
      total,
      today: todayCount,
      yesterday: yesterdayCount,
      due: dueCount,
    };

    // ---- Page of cards: only the fields the list card actually renders ----
    // .lean() skips building full Mongoose documents (notably faster for
    // read-only responses), and trimmed .select()/populate keeps the
    // payload small so the response serializes and transfers quickly.
    const rows = await VehicleReturn.find(match)
      .select(
        "vehicle handover receivedBy fuelLevel kilometersAtReturn receivingTime " +
          "scheduledReturnTime timeStatus delayText hasDamage damageCostDetails " +
          "customerName mobileNumber balanceAmount isDue createdAt updatedAt",
      )
      .populate({
        path: "vehicle",
        select: "vehicleName vehicleNumber manufacturer model variant color",
      })
      .populate({
        path: "handover",
        select:
          "customer payment.billSummary.totalAmount payment.billSummary.amountReceivedNow payment.billSummary.totalCollected",
        populate: { path: "customer", select: "fullName mobileNumber" },
      })
      .populate("receivedBy", "fullName")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const dashboard = rows.map((item) => {
      const returnDate = getISTDate(item.createdAt);
      let itemTab = "Older";
      if (returnDate === today) itemTab = "Today";
      else if (returnDate === yesterday) itemTab = "Yesterday";

      const billSummary = item.handover?.payment?.billSummary || {};
      const totalAmount = billSummary.totalAmount || 0;
      const amountReceivedNow = billSummary.amountReceivedNow || 0;
      const totalCollected = billSummary.totalCollected || 0;
      const balanceAmount = item.balanceAmount || 0;
      const isDue = !!item.isDue;

      return {
        _id: item._id,
        handoverId: item.handover?._id,
        tab: itemTab,
        isDue,
        customerName:
          item.customerName || item.handover?.customer?.fullName || "",
        mobileNumber:
          item.mobileNumber || item.handover?.customer?.mobileNumber || "",
        vehicleName: item.vehicle?.vehicleName || "",
        vehicleNumber: item.vehicle?.vehicleNumber || "",
        manufacturer: item.vehicle?.manufacturer || "",
        model: item.vehicle?.model || "",
        variant: item.vehicle?.variant || "",
        color: item.vehicle?.color || "",
        fuelLevel: item.fuelLevel ?? 0,
        kilometersAtReturn: item.kilometersAtReturn ?? 0,
        returnTime: item.receivingTime,
        scheduledReturnTime: item.scheduledReturnTime,
        timeStatus: item.timeStatus || "On Time",
        delayText: item.delayText || "",
        hasDamage: item.hasDamage || false,
        damageStatus: item.damageCostDetails?.status || "",
        repairEstimate: item.damageCostDetails?.repairEstimate || 0,
        totalAmount,
        amountReceivedNow,
        totalCollected,
        pendingAmount: balanceAmount,
        totalBalance: totalAmount,
        amountCollected: totalCollected || amountReceivedNow,
        finalBalance: balanceAmount,
        settlementStatus: balanceAmount > 0 ? "pending" : "paid",
        receivedBy: item.receivedBy?.fullName || "",
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    });

    return res.status(200).json({
      success: true,
      stats,
      page,
      limit,
      hasMore:
        page * limit <
        (tab === "Due"
          ? dueCount
          : tab === "Today"
            ? todayCount
            : tab === "Yesterday"
              ? yesterdayCount
              : total),
      returns: dashboard,
    });
  } catch (error) {
    console.error("Vehicle Returns Dashboard Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch dashboard",
    });
  }
};
