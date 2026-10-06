import axios from "axios";
import mongoose from "mongoose";
import ExtendBooking from "../models/extendBooking.model.js";
import Vehicle from "../models/vehicle.model.js"; // adjust path if different

const ALLOWED_DECISIONS = ["approved", "rejected"];

// ------------------------------------------------------------
// Customer App: submit an extension request
// ------------------------------------------------------------
export const createExtensionRequest = async (req, res) => {
  try {
    const { bookingId, handoverId, requestedDropDate, requestedDropTime, reason } = req.body;
    const customerId = req.user?._id;

    if (!customerId) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    if (!bookingId || !mongoose.Types.ObjectId.isValid(bookingId)) {
      return res.status(400).json({ success: false, message: "Valid bookingId is required." });
    }

    if (handoverId && !mongoose.Types.ObjectId.isValid(handoverId)) {
      return res.status(400).json({ success: false, message: "Invalid handoverId." });
    }

    const dropDate = requestedDropDate ? new Date(requestedDropDate) : null;
    if (!dropDate || Number.isNaN(dropDate.getTime())) {
      return res.status(400).json({ success: false, message: "Valid requestedDropDate is required." });
    }

    const existing = await ExtendBooking.findOne({ bookingId, status: "pending" }).lean();
    if (existing) {
      return res.status(400).json({
        success: false,
        message: "A pending extension request already exists for this booking.",
      });
    }

    const extension = await ExtendBooking.create({
      bookingId,
      handoverId: handoverId || undefined,
      customerId,
      requestedDropDate: dropDate,
      requestedDropTime: requestedDropTime || "",
      reason: reason || "",
    });

    if (process.env.FIREBASE_FUNCTION_URL_ADMINS) {
      axios
        .post(process.env.FIREBASE_FUNCTION_URL_ADMINS, {
          title: "New Extension Request",
          body: `A customer has requested to change their return date to ${dropDate.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}.`,
          data: { type: "extension_request", bookingId: String(bookingId) },
        })
        .catch((err) => console.error("Firebase admin notification failed:", err.message));
    }

    return res.status(201).json({
      success: true,
      message: "Extension request submitted successfully.",
      data: extension,
    });
  } catch (error) {
    console.error("createExtensionRequest Error:", error);
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// ------------------------------------------------------------
// Helper: pick a display image from a Vehicle doc
// ------------------------------------------------------------
const pickVehicleImage = (v) => {
  if (!v) return "";
  if (typeof v.image === "string" && v.image) return v.image;
  if (typeof v.vehicleImage === "string" && v.vehicleImage) return v.vehicleImage;
  if (Array.isArray(v.images) && v.images.length) {
    const first = v.images[0];
    return typeof first === "string" ? first : first?.url || "";
  }
  return "";
};

// ------------------------------------------------------------
// Operations App: fetch all requests
// ------------------------------------------------------------
export const getAllExtensionRequests = async (req, res) => {
  try {
    const requests = await ExtendBooking.find()
      .sort({ createdAt: -1 })
      .limit(500)
      .populate("customerId", "customerName name mobileNumber")
      .populate(
        "bookingId",
        "bookingCode vehicleId vehicleName vehicleNumber vehicleColor customerName customerPhone fromDate pickupTime dropTime toDate",
      )
      .populate("handoverId", "customer vehicle trip payment.totalFare handoverStatus")
      .populate("vehicleId", "vehicleName name vehicleNumber number color")
      .populate("processedBy", "name")
      .lean();

    // Current vehicle priority: handover.vehicle → request.vehicleId → booking.vehicleId
    const resolveVehicleId = (r) =>
      r.handoverId?.vehicle?.vehicleId ||
      r.vehicleId?._id ||
      r.vehicleId ||
      r.bookingId?.vehicleId ||
      null;

    const vehicleIds = [
      ...new Set(
        requests
          .map(resolveVehicleId)
          .filter(Boolean)
          .map((id) => id.toString())
          .filter((id) => mongoose.Types.ObjectId.isValid(id)),
      ),
    ];

    const vehicleDocs = vehicleIds.length
      ? await Vehicle.find({ _id: { $in: vehicleIds } })
          .select("vehicleName vehicleNumber color pricePerDay vehicleType image vehicleImage images status")
          .lean()
      : [];

    const vehicleMap = new Map(vehicleDocs.map((v) => [v._id.toString(), v]));

    const data = requests.map((r) => {
      const handover = r.handoverId && typeof r.handoverId === "object" ? r.handoverId : null;
      const booking = r.bookingId && typeof r.bookingId === "object" ? r.bookingId : {};
      const hv = handover?.vehicle || {};
      const vid = resolveVehicleId(r);
      const vDoc = vid ? vehicleMap.get(vid.toString()) : null;
      const reqVehicle = r.vehicleId && typeof r.vehicleId === "object" ? r.vehicleId : {};

      return {
        ...r,

        handoverId: handover?._id || r.handoverId || null,
        handoverStatus: handover?.handoverStatus || null,

        vehicle: {
          _id: vid || null,
          vehicleName:
            hv.vehicleName || vDoc?.vehicleName || reqVehicle.vehicleName || reqVehicle.name || booking.vehicleName || "",
          vehicleNumber:
            hv.vehicleNumber || vDoc?.vehicleNumber || reqVehicle.vehicleNumber || reqVehicle.number || booking.vehicleNumber || "",
          color: hv.vehicleColor || vDoc?.color || reqVehicle.color || booking.vehicleColor || "",
          vehicleType: vDoc?.vehicleType || "",
          pricePerDay: vDoc?.pricePerDay || null,
          image: pickVehicleImage(vDoc),
          status: vDoc?.status || "",
        },

        trip: {
          pickupDateTime: handover?.trip?.pickupDateTime || booking.fromDate || null,
          dropDateTime: handover?.trip?.dropDateTime || booking.toDate || null,
          numberOfDays: handover?.trip?.numberOfDays || null,
        },

        handover,
      };
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("getAllExtensionRequests Error:", error);
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// ------------------------------------------------------------
// Operations App: approve / reject
// ONLY updates the request's status (+ processedBy, rejectReason).
// Booking, handover and vehicle are NOT touched.
// ------------------------------------------------------------
export const updateExtensionStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const status = String(req.body?.status || "").toLowerCase();
    const rejectReason = String(req.body?.rejectReason || "").trim();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid extension id." });
    }

    if (!ALLOWED_DECISIONS.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${ALLOWED_DECISIONS.join(", ")}.`,
      });
    }

    if (status === "rejected" && !rejectReason) {
      return res.status(400).json({ success: false, message: "Reject reason is required." });
    }

    // Atomic: only a PENDING request can be processed (prevents double approve/reject)
    const updated = await ExtendBooking.findOneAndUpdate(
      { _id: id, status: "pending" },
      {
        $set: {
          status,
          processedBy: req.user?._id,
          rejectReason: status === "rejected" ? rejectReason : "",
        },
      },
      { new: true },
    )
      .populate("processedBy", "name")
      .populate("customerId", "_id");

    if (!updated) {
      const exists = await ExtendBooking.exists({ _id: id });
      return res.status(exists ? 409 : 404).json({
        success: false,
        message: exists
          ? "This request has already been processed."
          : "Extension request not found.",
      });
    }

    // Notify the customer (does not change any data)
    if (process.env.CUSTOMER_BACKEND_URL && updated.customerId?._id) {
      const label = status === "approved" ? "Approved" : "Rejected";
      axios
        .post(
          `${process.env.CUSTOMER_BACKEND_URL}/api/notifications`,
          {
            target: "specific",
            customerId: updated.customerId._id,
            title: `Extension ${label}`,
            body:
              status === "approved"
                ? "Your booking extension request was approved."
                : `Your booking extension request was rejected. Reason: ${rejectReason}`,
            payload: { type: "extension_update", bookingId: String(updated.bookingId) },
          },
          { headers: { "x-admin-key": process.env.CUSTOMER_ADMIN_API_KEY } },
        )
        .catch((err) => console.error("Customer notification failed:", err.message));
    }

    return res.status(200).json({
      success: true,
      message: `Extension ${status} successfully.`,
      data: updated,
    });
  } catch (error) {
    console.error("updateExtensionStatus Error:", error);
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};