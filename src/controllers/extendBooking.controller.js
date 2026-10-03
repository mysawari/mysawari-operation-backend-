import axios from "axios";
import ExtendBooking from "../models/extendBooking.model.js";
import Customer from "../models/customer.model.js";
import Vehicle from "../models/vehicle.model.js"; // NEW: adjust path if different

// Customer App uses this to submit an extension request
export const createExtensionRequest = async (req, res) => {
  try {
    const { bookingId, handoverId, requestedDropDate, requestedDropTime, reason } = req.body;

    const customerId = req.user._id;

    const existing = await ExtendBooking.findOne({ bookingId, status: "pending" });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: "A pending extension request already exists for this booking.",
      });
    }

    const extension = new ExtendBooking({
      bookingId,
      handoverId,
      customerId,
      requestedDropDate,
      requestedDropTime,
      reason,
    });

    await extension.save();

    if (process.env.FIREBASE_FUNCTION_URL_ADMINS) {
      axios
        .post(process.env.FIREBASE_FUNCTION_URL_ADMINS, {
          title: "New Extension Request",
          body: `A customer has requested to extend their booking until ${requestedDropDate}.`,
          data: { type: "extension_request", bookingId: bookingId },
        })
        .catch((err) => console.error("Firebase admin notification failed:", err.message));
    }

    res.status(201).json({
      success: true,
      message: "Extension request submitted successfully.",
      data: extension,
    });
  } catch (error) {
    console.error("createExtensionRequest Error:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// ------------------------------------------------------------
// Helper: pick a display image from a Vehicle doc, whatever the
// schema calls it.
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

// Operations App uses this to fetch all requests
export const getAllExtensionRequests = async (req, res) => {
  try {
    const requests = await ExtendBooking.find()
      .limit(500)
      .populate("customerId", "customerName name mobileNumber")
      .populate(
        "bookingId",
        "bookingCode vehicleId vehicleName vehicleNumber vehicleColor customerName customerPhone fromDate pickupTime dropTime toDate",
      )
      .populate("handoverId", "customer vehicle trip payment.totalFare handoverStatus")
      .populate("vehicleId", "vehicleName name vehicleNumber number color")
      .populate("processedBy", "name")
      .sort({ createdAt: -1 })
      .lean();

    // --------------------------------------------------------
    // Resolve the CURRENT vehicle for each request.
    // Priority: handover.vehicle (reflects exchanges)
    //         → request.vehicleId → booking.vehicleId
    // --------------------------------------------------------
    const resolveVehicleId = (r) =>
      r.handoverId?.vehicle?.vehicleId ||
      r.vehicleId?._id ||
      r.vehicleId ||
      r.bookingId?.vehicleId ||
      null;

    const vehicleIds = [
      ...new Set(
        requests
          .map((r) => resolveVehicleId(r))
          .filter(Boolean)
          .map((id) => id.toString()),
      ),
    ];

    const vehicleDocs = vehicleIds.length
      ? await Vehicle.find({ _id: { $in: vehicleIds } })
          .select("vehicleName vehicleNumber color pricePerDay vehicleType image vehicleImage images status")
          .lean()
      : [];

    const vehicleMap = new Map(vehicleDocs.map((v) => [v._id.toString(), v]));

    const data = requests.map((r) => {
      const handover = r.handoverId || null;
      const booking = r.bookingId || {};
      const hv = handover?.vehicle || {};
      const vid = resolveVehicleId(r);
      const vDoc = vid ? vehicleMap.get(vid.toString()) : null;
      const reqVehicle = r.vehicleId && typeof r.vehicleId === "object" ? r.vehicleId : {};

      return {
        ...r,

        // Flat ids the app needs for navigation
        handoverId: handover?._id || r.handoverId || null,
        handoverStatus: handover?.handoverStatus || null,

        // Normalised current vehicle
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

        // Current trip from the handover (source of truth)
        trip: {
          pickupDateTime: handover?.trip?.pickupDateTime || booking.fromDate || null,
          dropDateTime: handover?.trip?.dropDateTime || booking.toDate || null,
          numberOfDays: handover?.trip?.numberOfDays || null,
        },

        // Keep the populated handover available too
        handover,
      };
    });

    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("getAllExtensionRequests Error:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Operations App uses this to approve/reject
export const updateExtensionStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejectReason } = req.body;

    const extension = await ExtendBooking.findById(id).populate("customerId");
    if (!extension) {
      return res.status(404).json({ success: false, message: "Extension request not found." });
    }

    extension.status = status;
    extension.processedBy = req.user._id;
    if (status === "rejected" && rejectReason) {
      extension.rejectReason = rejectReason;
    }

    await extension.save();

    const updatedExtension = await ExtendBooking.findById(id).populate("processedBy", "name");

    if (process.env.CUSTOMER_BACKEND_URL && extension.customerId) {
      axios
        .post(
          `${process.env.CUSTOMER_BACKEND_URL}/api/notifications`,
          {
            target: "specific",
            customerId: extension.customerId._id,
            title: `Extension ${status.charAt(0).toUpperCase() + status.slice(1)}`,
            body: `Your booking extension request was ${status}. ${rejectReason ? `Reason: ${rejectReason}` : ""}`,
            payload: { type: "extension_update", bookingId: extension.bookingId },
          },
          { headers: { "x-admin-key": process.env.CUSTOMER_ADMIN_API_KEY } },
        )
        .catch((err) => console.error("Firebase customer notification failed:", err.message));
    }

    res.status(200).json({
      success: true,
      message: `Extension ${status} successfully.`,
      data: updatedExtension,
    });
  } catch (error) {
    console.error("updateExtensionStatus Error:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};