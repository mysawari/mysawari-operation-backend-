import ExtendBooking from "../models/extendBooking.model.js";

// Customer App uses this to submit an extension request
export const createExtensionRequest = async (req, res) => {
  try {
    const { bookingId, handoverId, requestedDropDate, requestedDropTime, reason } = req.body;
    
    // In actual implementation, req.user._id is the customer
    const customerId = req.user._id;

    // Check if a pending extension already exists for this booking
    const existing = await ExtendBooking.findOne({ bookingId, status: "pending" });
    if (existing) {
      return res.status(400).json({ success: false, message: "A pending extension request already exists for this booking." });
    }

    const extension = new ExtendBooking({
      bookingId,
      handoverId,
      customerId,
      requestedDropDate,
      requestedDropTime,
      reason
    });

    await extension.save();
    res.status(201).json({ success: true, message: "Extension request submitted successfully.", data: extension });
  } catch (error) {
    console.error("createExtensionRequest Error:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Operations App uses this to fetch all requests
export const getAllExtensionRequests = async (req, res) => {
  try {
    const requests = await ExtendBooking.find()
      .populate("customerId", "customerName name mobileNumber")
      .populate("bookingId", "bookingCode vehicleName vehicleNumber pickupTime dropTime toDate")
      .populate("handoverId", "vehicle vehicleHistory trip payment")
      .populate("vehicleId", "vehicleName name number")
      .populate("processedBy", "name")
      .sort({ createdAt: -1 });
    
    res.status(200).json({ success: true, data: requests });
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

    const extension = await ExtendBooking.findById(id);
    if (!extension) {
      return res.status(404).json({ success: false, message: "Extension request not found." });
    }

    extension.status = status;
    extension.processedBy = req.user._id;
    if (status === "rejected" && rejectReason) {
      extension.rejectReason = rejectReason;
    }

    await extension.save();
    res.status(200).json({ success: true, message: `Extension ${status} successfully.`, data: extension });
  } catch (error) {
    console.error("updateExtensionStatus Error:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};
