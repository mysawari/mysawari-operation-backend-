import axios from "axios";
import mongoose from "mongoose";
import asyncHandler from "../utils/asyncHandler.js";

// The Customer Backend URL and Admin Key (Should ideally be in .env)
const CUSTOMER_BACKEND_URL = process.env.CUSTOMER_BACKEND_URL || "https://mysawari-customer-backend-1.onrender.com";
const ADMIN_API_KEY = process.env.CUSTOMER_ADMIN_API_KEY || "mysawari_admin_secret_key_84920";

// @desc    Create and send a push notification by proxying to Customer Backend
// @route   POST /api/v1/notifications/send
// @access  Private (Admin)
export const sendNotification = asyncHandler(async (req, res) => {
  const { title, body, target, customerId, data } = req.body;

  if (!title || !body) {
    return res.status(400).json({
      success: false,
      message: "Title and body are required",
    });
  }

  try {
    if (target === "specific" && Array.isArray(customerId)) {
      // Send multiple notifications, one for each customer
      const promises = customerId.map((id) =>
        axios.post(
          `${CUSTOMER_BACKEND_URL}/api/notifications`,
          {
            title,
            body,
            target: "specific",
            customerId: id,
            payload: data || {},
          },
          { headers: { "x-admin-key": ADMIN_API_KEY } }
        )
      );
      await Promise.all(promises);

      return res.status(201).json({
        success: true,
        message: `Notification sent to ${customerId.length} customers successfully`,
      });
    }

    // Single notification (or target === 'all')
    const response = await axios.post(
      `${CUSTOMER_BACKEND_URL}/api/notifications`,
      {
        title,
        body,
        target: target || "all",
        customerId: target === "specific" ? customerId : null,
        payload: data || {},
      },
      { headers: { "x-admin-key": ADMIN_API_KEY } }
    );

    res.status(201).json({
      success: true,
      message: "Notification created and processed by customer backend successfully",
      data: response.data,
    });
  } catch (error) {
    console.error("Failed to proxy notification to customer backend:", error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || "Failed to process notification via customer backend",
    });
  }
});

// @desc    Get all customers from the Customer App database
// @route   GET /api/v1/notifications/customers
// @access  Private (Admin)
export const getCustomersForNotification = asyncHandler(async (req, res) => {
  const customers = await mongoose.connection.db
    .collection("customers")
    .find({}, { projection: { customerName: 1, mobileNumber: 1, email: 1 } })
    .toArray();

  res.status(200).json({
    success: true,
    data: customers,
  });
});

// @desc    Get all notifications (Admin history view)
// @route   GET /api/v1/notifications
// @access  Private (Admin)
export const getNotifications = asyncHandler(async (req, res) => {
  const notifications = await mongoose.connection.db
    .collection("notifications")
    .find({})
    .sort({ createdAt: -1 })
    .toArray();

  res.status(200).json({
    success: true,
    data: notifications,
  });
});
