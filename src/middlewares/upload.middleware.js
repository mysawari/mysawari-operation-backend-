import multer from "multer";
import mongoose from "mongoose";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import cloudinary from "../config/cloudinary.js";
import { randomUUID } from "crypto";

/* ==================================
   IMAGE FILE FILTER
================================== */

const imageFileFilter = (req, file, cb) => {
  const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

  if (allowedTypes.includes(file.mimetype)) {
    return cb(null, true);
  }

  return cb(
    new Error("Only JPG, JPEG, PNG and WEBP image files are allowed"),
    false,
  );
};

/* ==================================
   CLOUDINARY STORAGE
================================== */

const imageStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: "my-sawari/handover",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    public_id: `${randomUUID()}`,
    overwrite: false,
    resource_type: "image",
  }),
});

/* ==================================
   MULTER INSTANCE
================================== */

const upload = multer({
  storage: imageStorage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
  },
});

/* ==================================
   HANDOVER UPLOAD
================================== */

export const handoverUpload = upload.fields([
  { name: "customerPhoto", maxCount: 1 },
  { name: "customerProfileImage", maxCount: 1 },
  { name: "customerWithVehicle", maxCount: 1 },
  { name: "idCardFront", maxCount: 1 },
  { name: "idCardBack", maxCount: 1 },
  { name: "vehicleFront", maxCount: 1 },
  { name: "vehicleRear", maxCount: 1 },
  { name: "vehicleLeft", maxCount: 1 },
  { name: "vehicleRight", maxCount: 1 },
]);

/* ==================================
   VEHICLE RETURN — INSTANT SINGLE-PHOTO UPLOAD (NEW)
   POST /vehicle-return/images/:handoverId/:field
   multipart body: image=<file>

   One photo per request, uploaded straight to Cloudinary into a
   per-handover folder. Cloudinary also downsizes huge camera photos on
   ingest so storage/bandwidth stay small.
================================== */

// Every return photo for a handover goes in its own folder. The
// controller uses this to verify submitted photos belong to the handover.
export const returnImageFolder = (handoverId) =>
  `my-sawari/vehicle-return/${handoverId}`;

const returnImageStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req) => ({
    folder: returnImageFolder(req.params.handoverId),
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    public_id: `${req.params.field}_${randomUUID()}`,
    overwrite: false,
    resource_type: "image",
    transformation: [
      { width: 1600, height: 1600, crop: "limit", quality: "auto" },
    ],
  }),
});

const returnImageUploader = multer({
  storage: returnImageStorage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
    files: 1,
  },
}).single("image");

// Wrapped so multer/Cloudinary errors always become a clean 400 JSON
// response on this route, even without a global error handler.
export const returnImageUpload = (req, res, next) => {
  returnImageUploader(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message:
          err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
            ? "Photo is too large (max 10 MB)"
            : err.message || "Photo upload failed",
      });
    }
    next();
  });
};

/* ==================================
   VEHICLE RETURN UPLOAD (LEGACY)
   No longer used by /vehicle-return/receive — photos are uploaded
   one by one via /vehicle-return/images and submitted as URLs. Kept only in case something else still imports it.
   NOTE: it was missing the bike fields (tyreFront, tyreRear, helmet),
   so any bike return with those optional photos failed with multer's
   "Unexpected field" error.
================================== */

export const vehicleReturnUpload = upload.fields([
  { name: "vehicleFront", maxCount: 1 },
  { name: "vehicleRear", maxCount: 1 },
  { name: "vehicleLeft", maxCount: 1 },
  { name: "vehicleRight", maxCount: 1 },
  { name: "tyreFrontLeft", maxCount: 1 },
  { name: "tyreFrontRight", maxCount: 1 },
  { name: "tyreRearLeft", maxCount: 1 },
  { name: "tyreRearRight", maxCount: 1 },
  { name: "spareTyre", maxCount: 1 },
  { name: "tyreFront", maxCount: 1 },
  { name: "tyreRear", maxCount: 1 },
  { name: "helmet", maxCount: 1 },
  { name: "toolkit", maxCount: 1 },
  { name: "damageImages", maxCount: 20 },
  { name: "additionalImages", maxCount: 20 },
]);

export const vehicleExchangeUpload = upload.fields([
  { name: "vehicleFront", maxCount: 1 },
  { name: "vehicleRear", maxCount: 1 },
  { name: "vehicleLeft", maxCount: 1 },
  { name: "vehicleRight", maxCount: 1 },
  { name: "additional", maxCount: 1 },
]);

/* ==================================
   MULTER ERROR HANDLER
================================== */

export const multerErrorHandler = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }

  if (err) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }

  next();
};

export const singleImageUpload = upload.single("image");