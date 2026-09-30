import axios from "axios";
import Offer from "../models/offer.model.js";

const CUSTOMER_BACKEND_URL = process.env.CUSTOMER_BACKEND_URL || "https://mysawari-customer-backend-1.onrender.com";
const ADMIN_API_KEY = process.env.CUSTOMER_ADMIN_API_KEY || "mysawari_admin_secret_key_84920";

// @desc    Get all offers
// @route   GET /api/v1/offers
// @access  Private
export const getOffers = async (req, res) => {
  try {
    const offers = await Offer.find().sort({ sortOrder: 1, createdAt: -1 });
    res.status(200).json({ success: true, count: offers.length, data: offers });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create new offer
// @route   POST /api/v1/offers
// @access  Private
export const createOffer = async (req, res) => {
  try {
    const offerData = { ...req.body };
    
    // Parse nested objects if sent as strings (e.g. from FormData)
    if (typeof offerData.gradientColors === 'string') {
      try { offerData.gradientColors = JSON.parse(offerData.gradientColors); } catch(e) {}
    }

    if (req.file) {
      offerData.image = {
        url: req.file.path,
        publicId: req.file.filename,
      };
    }

    const offer = await Offer.create(offerData);

    // Auto-Notification to all customers via Customer Backend
    if (offer.active) {
      try {
        const notifTitle = offer.type === "coupon" ? "New Coupon Available! 🎉" : "Exclusive Deal Alert! 🚘";
        const notifBody = `${offer.title} - ${offer.subtitle || "Check out our latest offer on the app!"}`;
        
        await axios.post(
          `${CUSTOMER_BACKEND_URL}/api/notifications`,
          {
            title: notifTitle,
            body: notifBody,
            target: "all",
            payload: { type: "offer", offerId: offer._id },
          },
          { headers: { "x-admin-key": ADMIN_API_KEY } }
        );
        console.log("Auto-notification for new offer sent successfully.");
      } catch (notifErr) {
        console.error("Failed to send auto-notification for offer:", notifErr.message);
        // We don't fail the offer creation if notification fails.
      }
    }

    res.status(201).json({ success: true, data: offer });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Update offer
// @route   PUT /api/v1/offers/:id
// @access  Private
export const updateOffer = async (req, res) => {
  try {
    const offerData = { ...req.body };
    
    if (typeof offerData.gradientColors === 'string') {
      try { offerData.gradientColors = JSON.parse(offerData.gradientColors); } catch(e) {}
    }

    if (req.file) {
      offerData.image = {
        url: req.file.path,
        publicId: req.file.filename,
      };
    }

    const offer = await Offer.findByIdAndUpdate(req.params.id, offerData, {
      new: true,
      runValidators: true,
    });

    if (!offer) {
      return res.status(404).json({ success: false, message: "Offer not found" });
    }

    res.status(200).json({ success: true, data: offer });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Delete offer
// @route   DELETE /api/v1/offers/:id
// @access  Private
export const deleteOffer = async (req, res) => {
  try {
    const offer = await Offer.findByIdAndDelete(req.params.id);
    
    if (!offer) {
      return res.status(404).json({ success: false, message: "Offer not found" });
    }

    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
