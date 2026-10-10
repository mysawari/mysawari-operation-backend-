import mongoose from "mongoose";
import fs from "fs/promises";
import cloudinary from "../config/cloudinary.js";
import Vehicle from "../models/vehicle.model.js";
import Maintenance from "../models/maintenance.model.js";

// add vehicle screen
export const createVehicle = async (req, res, next) => {
  try {
    const companyId = req.user.company || req.user._id;

    const {
      displayName,
      vehicleName,
      vehicleNumber,
      manufacturer,
      model,
      engineCapacity,
      mileage,
      ac,
      carPlay,
      bluetooth,
      touchscreen,
      usbCharging,
      sunroof,
      airbags,
      absEbd,
      rearParkingSensors,
      rearCamera,
      gps,
      digitalDisplay,
      bikeAbs,
      discBrakes,
      cbs,
      variant,
      vehicleType,
      fuelType,
      transmission,
      seatingCapacity,
      color,
      chassisNumber,
      engineNumber,
      registrationDate,
      insuranceValidUpto,
      pucValidUpto,
      fitnessValidUpto,
      notes,
      status,
    } = req.body;

    if (!vehicleNumber) {
      return res.status(400).json({
        success: false,
        message: "Vehicle number is required",
      });
    }

    const existingVehicle = await Vehicle.findOne({
      vehicleNumber: vehicleNumber.toUpperCase(),
      isDeleted: false,
    });

    if (existingVehicle) {
      return res.status(400).json({
        success: false,
        message: "Vehicle with this number already exists",
      });
    }

    const images =
      req.files?.map((file) => ({
        url: file.path,
        publicId: file.filename,
      })) || [];

    const vehicle = await Vehicle.create({
      company: companyId,
      createdBy: req.user._id,
      displayName: displayName || "",
      vehicleName,
      vehicleNumber: vehicleNumber.toUpperCase(),
      manufacturer,
      model,
      engineCapacity: engineCapacity || "",
      mileage: mileage || "",
      ac: ac || "",
      carPlay: carPlay || "",
      bluetooth: bluetooth || "",
      touchscreen: touchscreen || "",
      usbCharging: usbCharging || "",
      sunroof: sunroof || "",
      airbags: airbags || "",
      absEbd: absEbd || "",
      rearParkingSensors: rearParkingSensors || "",
      rearCamera: rearCamera || "",
      gps: gps || "",
      digitalDisplay: digitalDisplay || "",
      bikeAbs: bikeAbs || "",
      discBrakes: discBrakes || "",
      cbs: cbs || "",
      variant,
      vehicleType,
      fuelType,
      transmission,
      seatingCapacity: Number(seatingCapacity),
      color,
      chassisNumber,
      engineNumber,
      registrationDate: registrationDate || null,
      insuranceValidUpto: insuranceValidUpto || null,
      pucValidUpto: pucValidUpto || null,
      fitnessValidUpto: fitnessValidUpto || null,
      notes,
      status: status || "available",
      images,
    });

    res.status(201).json({
      success: true,
      message: "Vehicle added successfully",
      data: vehicle,
    });
  } catch (error) {
    next(error);
  }
};
// manage vehicle page v1.0
export const getAllVehicle = async (req, res, next) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    // Default limit brought down from 1000 to 20 — 1000 meant this
    // endpoint was never really paginating, just quietly capping itself.
    // A real page size lets the list start rendering fast regardless of
    // fleet size, with more loaded on scroll.
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 100);
    const skip = (page - 1) * limit;
    const filters = { isDeleted: false };

    if (req.query.status && req.query.status !== "All") {
      filters.status = req.query.status;
    }

    // Search now happens in the query, not by downloading every vehicle
    // and running .filter() in the app. Escaped so special regex
    // characters in a plate number ("MH-12...") can't break the match.
    if (req.query.search) {
      const term = req.query.search.trim();
      if (term) {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(escaped, "i");
        filters.$or = [{ vehicleName: regex }, { vehicleNumber: regex }];
      }
    }

    const [vehicles, total, stats] = await Promise.all([
      Vehicle.find(filters)
        // Only the fields the fleet-list card actually renders, plus
        // just the FIRST image (the list only ever shows one cover
        // photo per card) instead of the full images array.
        .select({
          displayName: 1,
          vehicleName: 1,
          vehicleNumber: 1,
          fuelType: 1,
          transmission: 1,
          seatingCapacity: 1,
          status: 1,
          registrationDate: 1,
          pricePerDay: 1,
          images: { $slice: 1 },
          createdAt: 1,
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      // Count respects the same filters, so pagination math (hasMore /
      // pages) is correct for whatever search/status the user has active.
      Vehicle.countDocuments(filters),

      // Stat cards are intentionally fleet-WIDE and unfiltered — they
      // always reflect the whole fleet regardless of which tab/search
      // is active, matching what the four cards at the top mean to show.
      Vehicle.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);

    res.status(200).json({
      success: true,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      hasMore: page * limit < total,
      stats,
      data: vehicles,
    });
  } catch (error) {
    next(error);
  }
};
// v1.1
export const getAllVehicles = async (req, res, next) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    // Default limit brought down from 1000 to 20 — 1000 meant this
    // endpoint was never really paginating, just quietly capping itself.
    // A real page size lets the list start rendering fast regardless of
    // fleet size, with more loaded on scroll.
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 100);
    const skip = (page - 1) * limit;
    const filters = { isDeleted: false };

    if (req.query.status && req.query.status !== "All") {
      filters.status = req.query.status;
    }

    // NEW: optional category filter (car / bike). Only applied when a
    // caller explicitly sends it, so existing screens hitting this same
    // controller without a category param behave exactly as before.
    if (req.query.category && req.query.category !== "All") {
      const categoryTerm = String(req.query.category).trim();
      if (categoryTerm) {
        // Case-insensitive exact match so "Car"/"car"/"CAR" all work
        // regardless of how it's stored in the DB.
        filters.category = new RegExp(`^${categoryTerm}$`, "i");
      }
    }

    // Search now happens in the query, not by downloading every vehicle
    // and running .filter() in the app. Escaped so special regex
    // characters in a plate number ("MH-12...") can't break the match.
    if (req.query.search) {
      const term = req.query.search.trim();
      if (term) {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(escaped, "i");
        filters.$or = [{ vehicleName: regex }, { vehicleNumber: regex }];
      }
    }

    const [vehicles, total, stats] = await Promise.all([
      Vehicle.find(filters)
        // Only the fields the fleet-list card actually renders, plus
        // just the FIRST image (the list only ever shows one cover
        // photo per card) instead of the full images array.
        .select({
          displayName: 1,
          vehicleName: 1,
          vehicleNumber: 1,
          fuelType: 1,
          transmission: 1,
          seatingCapacity: 1,
          status: 1,
          category: 1,
          registrationDate: 1,
          pricePerDay: 1,
          images: { $slice: 1 },
          createdAt: 1,
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      // Count respects the same filters, so pagination math (hasMore /
      // pages) is correct for whatever search/status/category the user
      // has active.
      Vehicle.countDocuments(filters),

      // Stat cards are intentionally fleet-WIDE and unfiltered — they
      // always reflect the whole fleet regardless of which tab/search
      // is active, matching what the four cards at the top mean to show.
      Vehicle.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);

    res.status(200).json({
      success: true,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      hasMore: page * limit < total,
      stats,
      data: vehicles,
    });
  } catch (error) {
    next(error);
  }
};

export const getAvailableVehicles = async (req, res, next) => {
  try {
    const vehicles = await Vehicle.find({
      status: "available",
      isDeleted: false,
    })
      .select({
        _id: 1,
        vehicleName: 1,
        vehicleNumber: 1,
        manufacturer: 1,
        model: 1,
        variant: 1,
        color: 1,
        vehicleType: 1,
        seatingCapacity: 1,
        transmission: 1,
        fuelType: 1,
        pricePerDay: 1,
        status: 1
      })
      .sort({ vehicleName: 1 })
      .lean();

    const data = vehicles.map((vehicle) => ({
      ...vehicle,

      pricing: {
        pricePerDay: vehicle.pricePerDay || 0,
        currency: "INR",
      },
    }));

    return res.status(200).json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    next(error);
  }
};
export const getAll = async (req, res, next) => {
  try {
    const vehicles = await Vehicle.find({
      isDeleted: false,
    })
      .select({
        _id: 1,
        vehicleName: 1,
        vehicleNumber: 1,
        manufacturer: 1,
        model: 1,
        variant: 1,
        color: 1,
        vehicleType: 1,
        seatingCapacity: 1,
        transmission: 1,
        fuelType: 1,
        pricePerDay: 1,
        status: 1
      })
      .sort({ vehicleName: 1 })
      .lean();

    const data = vehicles.map((vehicle) => ({
      ...vehicle,

      pricing: {
        pricePerDay: vehicle.pricePerDay || 0,
        currency: "INR",
      },
    }));

    return res.status(200).json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const getSingleVehicle = async (req, res, next) => {
  try {
    const vehicle = await Vehicle.findOne({
      _id: req.params.id,
      isDeleted: false,
    });

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: "Vehicle not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: vehicle,
    });
  } catch (error) {
    next(error);
  }
};

export const updateVehicle = async (req, res, next) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id);

    if (!vehicle || vehicle.isDeleted) {
      return res.status(404).json({
        success: false,
        message: "Vehicle not found",
      });
    }

    const allowedFields = [
      "displayName",
      "vehicleName",
      "vehicleNumber",
      "manufacturer",
      "model",
      "engineCapacity",
      "mileage",
      "ac",
      "carPlay",
      "bluetooth",
      "touchscreen",
      "usbCharging",
      "sunroof",
      "airbags",
      "absEbd",
      "rearParkingSensors",
      "rearCamera",
      "gps",
      "digitalDisplay",
      "bikeAbs",
      "discBrakes",
      "cbs",
      "variant",
      "pricePerDay",
      "category",
      "vehicleType",
      "fuelType",
      "transmission",
      "seatingCapacity",
      "color",
      "chassisNumber",
      "engineNumber",
      "registrationDate",
      "insuranceValidUpto",
      "pucValidUpto",
      "fitnessValidUpto",
      "notes",
    ];

    // -----------------------------------------
    // Category validation (must run BEFORE assignment)
    // -----------------------------------------
    if (
      req.body.category !== undefined &&
      req.body.category !== null &&
      req.body.category !== "" &&
      !["bike", "car"].includes(req.body.category)
    ) {
      return res.status(400).json({
        success: false,
        message: "Category must be either bike or car",
      });
    }

    const effectiveCategory = req.body.category ?? vehicle.category;

    // -----------------------------------------
    // vehicleType validation (must run BEFORE assignment)
    // -----------------------------------------
    const carVehicleTypes = [
      "SUV", "Sedan", "Hatchback", "Luxury", "Tempo Traveller", "Mini Bus", "Bus",
    ];

    if (req.body.vehicleType !== undefined) {
      const incomingType = String(req.body.vehicleType).trim();

      if (incomingType) {
        if (effectiveCategory === "car") {
          const matched = carVehicleTypes.find(
            (t) => t.toLowerCase() === incomingType.toLowerCase()
          );

          if (!matched) {
            return res.status(400).json({
              success: false,
              message: `vehicleType must be one of: ${carVehicleTypes.join(", ")}. Received: "${incomingType}"`,
            });
          }

          req.body.vehicleType = matched; // normalize casing
        } else if (effectiveCategory === "bike") {
          return res.status(400).json({
            success: false,
            message: "vehicleType only applies to vehicles with category 'car'",
          });
        }
      }
    }

    // -----------------------------------------
    // Update fields (now safe — bad values already rejected above)
    // -----------------------------------------
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        vehicle[field] = req.body[field];
      }
    });

    // -----------------------------------------
    // Vehicle number normalization
    // -----------------------------------------
    if (vehicle.vehicleNumber) {
      vehicle.vehicleNumber = vehicle.vehicleNumber.toUpperCase().trim();
    }

    // -----------------------------------------
    // Status
    // -----------------------------------------
    if (req.body.status !== undefined) {
      const allowedStatuses = ["available", "rent", "service"];

      if (!allowedStatuses.includes(req.body.status)) {
        return res.status(400).json({
          success: false,
          message: "Status must be available, rent, or service",
        });
      }

      vehicle.status = req.body.status;
    }

    // -----------------------------------------
    // Handle Images
    // -----------------------------------------
    let updatedImages = [];
    
    if (req.body.existingImages) {
      const existing = Array.isArray(req.body.existingImages) 
        ? req.body.existingImages 
        : [req.body.existingImages];
        
      // Keep only images that exist in the request AND are valid Cloudinary URLs (must start with http)
      updatedImages = vehicle.images.filter(
        (img) => existing.includes(img.url) && img.url.startsWith("http")
      );
    }

    if (req.files?.length > 0) {
      const newImages = req.files.map((file) => ({
        url: file.path,
        publicId: file.filename,
      }));

      updatedImages.push(...newImages);
    }
    
    vehicle.images = updatedImages;

    await vehicle.save();

    return res.status(200).json({
      success: true,
      message: "Vehicle updated successfully",
      data: vehicle,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteVehicle = async (req, res, next) => {
  try {
    if (req.user.role !== "SUPER_ADMIN") {
      return res.status(403).json({
        success: false,
        message:
          "Only Super Admin can delete vehicles. Please contact your administrator.",
      });
    }

    const vehicle = await Vehicle.findOne({
      _id: req.params.id,
      isDeleted: false,
    });

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: "Vehicle not found",
      });
    }

    await Vehicle.updateOne(
      { _id: vehicle._id },
      { $set: { isDeleted: true } }
    );

    return res.status(200).json({
      success: true,
      message: "Vehicle deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

export const updateVehicleStatus = async (req, res, next) => {
  try {
    const { status } = req.body;

    const vehicle = await Vehicle.findOne({
      _id: req.params.id,
      isDeleted: false,
    });

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: "Vehicle not found",
      });
    }

    vehicle.status = status;
    await vehicle.save();

    return res.status(200).json({
      success: true,
      message: "Vehicle status updated successfully",
      data: vehicle,
    });
  } catch (error) {
    next(error);
  }
};

// maintenance controller
export const uploadMaintenanceImage = async (req, res, next) => {
  const localPath = req.file?.path;

  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No image file provided",
      });
    }

    const result = await cloudinary.uploader.upload(localPath, {
      folder: "fleet/maintenance",
      resource_type: "image",
      transformation: [{ quality: "auto", fetch_format: "auto" }],
    });

    await fs.unlink(localPath).catch(() => {});

    return res.status(200).json({
      success: true,
      message: "Image uploaded successfully",
      url: result.secure_url,
      publicId: result.public_id,
    });
  } catch (error) {
    if (localPath) {
      await fs.unlink(localPath).catch(() => {});
    }
    console.log("Cloudinary upload error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to upload image. Please try again.",
    });
  }
};
const sendDuplicateResponse = (res, existing) =>
  res.status(200).json({
    success: true,
    message: "Maintenance already created",
    data: existing,
    duplicate: true,
  });
 
export const createMaintenance = async (req, res, next) => {
  try {
    const {
      vehicle,
      maintenanceType,
      title,
      description,
      garage,
      costs,
      odometer,
      expectedCompletionDate,
      images,
      additionalNotes,
      estimatedDays,
    } = req.body;
 
    // Header takes priority, body is the fallback
    const rawKey = req.get("Idempotency-Key") || req.body.idempotencyKey || "";
    const idempotencyKey = rawKey.toString().trim() || undefined;
 
    /* ===============================
       VALIDATION
    =============================== */
 
    const missing = [];
 
    if (!vehicle) missing.push("vehicle");
    if (!maintenanceType) missing.push("maintenanceType");
    if (!title?.trim()) missing.push("title");
    if (!description?.trim()) missing.push("description");
    if (!garage?.name?.trim()) missing.push("garage.name");
 
    if (missing.length) {
      return res.status(400).json({
        success: false,
        message: `Missing required field(s): ${missing.join(", ")}`,
      });
    }
 
    if (!mongoose.Types.ObjectId.isValid(vehicle)) {
      return res.status(400).json({
        success: false,
        message: "Invalid vehicle id",
      });
    }
 
    if (!["Major", "Minor"].includes(maintenanceType)) {
      return res.status(400).json({
        success: false,
        message: "Maintenance type must be Major or Minor",
      });
    }
 
    /* ===============================
       DUPLICATE CHECK (FAST PATH)
       Same request already processed -> return the existing record
    =============================== */
 
    if (idempotencyKey) {
      const existing = await Maintenance.findOne({ idempotencyKey });
      if (existing) return sendDuplicateResponse(res, existing);
    }
 
    /* ===============================
       CHECK VEHICLE EXISTS
    =============================== */
 
    const existingVehicle = await Vehicle.findOne({
      _id: vehicle,
      isDeleted: false,
    });
 
    if (!existingVehicle) {
      return res.status(404).json({
        success: false,
        message: "Vehicle not found",
      });
    }
 
    /* ===============================
       COST CALCULATION
    =============================== */
 
    const partsCost = Number(costs?.partsCost) || 0;
    const labourCost = Number(costs?.labourCost) || 0;
    const totalCost = Number(costs?.totalCost) || partsCost + labourCost;
 
    /* ===============================
       DATES
       startDate / endDate are required by the schema
    =============================== */
 
    const startDate = new Date();
 
    let completionDate = null;
    if (expectedCompletionDate) {
      const parsed = new Date(expectedCompletionDate);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid expected completion date",
        });
      }
      completionDate = parsed;
    }
 
    const endDate =
      completionDate && completionDate > startDate ? completionDate : startDate;
 
    /* ===============================
       CREATE MAINTENANCE
    =============================== */
 
    let maintenance;
 
    try {
      maintenance = await Maintenance.create({
        idempotencyKey,
 
        vehicle: existingVehicle._id,
 
        startDate,
        endDate,
 
        maintenanceType,
 
        title: title.trim(),
 
        description: description.trim(),
 
        garage: {
          name: garage.name.trim(),
          contact: garage.contact?.trim() || "",
          address: garage.address?.trim() || "",
          gstin: garage.gstin?.trim() || "",
        },
 
        costs: {
          partsCost,
          labourCost,
          totalCost,
        },
 
        odometer:
          odometer !== "" && odometer !== undefined && odometer !== null
            ? Number(odometer)
            : null,
 
        expectedCompletionDate: completionDate,
 
        images: Array.isArray(images) ? images : [],
 
        additionalNotes: additionalNotes?.trim() || "",
 
        statusHistory: [
          {
            status: "Scheduled",
            changedBy: req.user._id,
            note: "Maintenance created",
          },
        ],
 
        createdBy: req.user._id,
      });
    } catch (createError) {
      // Two identical requests arrived at the same moment: the unique
      // index let only one through, so return that one.
      if (
        createError?.code === 11000 &&
        createError?.keyPattern?.idempotencyKey
      ) {
        const existing = await Maintenance.findOne({ idempotencyKey });
        if (existing) return sendDuplicateResponse(res, existing);
      }
      throw createError;
    }
 
    /* ===============================
       VEHICLE STATUS UPDATE - TEMPORARILY DISABLED
    =============================== */
 
    // try {
    //   const updatedVehicle = await Vehicle.findByIdAndUpdate(
    //     existingVehicle._id,
    //     {
    //       $set: {
    //         status: "service",
    //         "maintenance.required": true,
    //         "maintenance.currentMaintenance": maintenance._id,
    //         "maintenance.reason": title.trim(),
    //         "maintenance.estimatedDays": Number(estimatedDays) || 0,
    //         "maintenance.estimatedCompletionDate": completionDate,
    //         "maintenance.markedBy": req.user._id,
    //         "maintenance.markedAt": new Date(),
    //       },
    //       $push: {
    //         "maintenance.maintenanceHistory": maintenance._id,
    //       },
    //     },
    //     { new: true },
    //   );
    //
    //   if (!updatedVehicle) {
    //     await Maintenance.findByIdAndDelete(maintenance._id);
    //     return res.status(500).json({
    //       success: false,
    //       message: "Failed to update vehicle status",
    //     });
    //   }
    // } catch (vehicleUpdateError) {
    //   await Maintenance.findByIdAndDelete(maintenance._id);
    //   throw vehicleUpdateError;
    // }
 
    return res.status(201).json({
      success: true,
      message: "Maintenance created successfully",
      data: maintenance,
    });
  } catch (error) {
    next(error);
  }
};

const MAX_LIMIT = 50;
 
// The app shows "Pending" / "Ongoing", the DB stores "Scheduled" /
// "In Progress". Accept both so the API is forgiving.
const STATUS_ALIASES = {
  pending: "Scheduled",
  scheduled: "Scheduled",
  ongoing: "In Progress",
  "in progress": "In Progress",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
  canceled: "Cancelled",
};
 
// Escape user input before putting it into a RegExp, so characters like
// "(" or "+" in a search don't throw or match unexpectedly.
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
 
const parseDate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};
 
export const getMaintenances = async (req, res, next) => {
  try {
    const { status, maintenanceType, vehicle, search, createdFrom, createdTo } =
      req.query;
 
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 20, 1),
      MAX_LIMIT,
    );
 
    /* ===============================
       BUILD FILTER (runs in MongoDB, not in Node)
    =============================== */
 
    const filter = { isDeleted: false };
 
    if (status) {
      const mapped = STATUS_ALIASES[String(status).trim().toLowerCase()];
      if (!mapped) {
        return res.status(400).json({
          success: false,
          message: "Invalid status filter",
        });
      }
      filter.status = mapped;
    }
 
    if (maintenanceType) {
      if (!["Major", "Minor"].includes(maintenanceType)) {
        return res.status(400).json({
          success: false,
          message: "Maintenance type must be Major or Minor",
        });
      }
      filter.maintenanceType = maintenanceType;
    }
 
    if (vehicle) {
      if (!mongoose.Types.ObjectId.isValid(vehicle)) {
        return res.status(400).json({
          success: false,
          message: "Invalid vehicle id",
        });
      }
      filter.vehicle = new mongoose.Types.ObjectId(vehicle);
    }
 
    // Date range on createdAt. The app sends the start/end of the month
    // in the user's own timezone, so "This Month" is correct for India.
    const from = parseDate(createdFrom);
    const to = parseDate(createdTo);
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = from;
      if (to) filter.createdAt.$lt = to;
    }
 
    // Search: title, description and garage live on the maintenance,
    // vehicle name / number live on the vehicle. Find matching vehicles
    // first (one small query), then match either side in the DB.
    const keyword = search ? String(search).trim() : "";
    if (keyword) {
      const regex = new RegExp(escapeRegex(keyword), "i");
 
      const vehicleIds = await Vehicle.distinct("_id", {
        $or: [{ vehicleName: regex }, { vehicleNumber: regex }],
      });
 
      const or = [
        { title: regex },
        { description: regex },
        { "garage.name": regex },
      ];
      if (vehicleIds.length) {
        or.push({ vehicle: { $in: vehicleIds } });
      }
 
      filter.$or = or;
    }
 
    /* ===============================
       QUERY ONE PAGE + COUNT IN PARALLEL
    =============================== */
 
    const skip = (page - 1) * limit;
 
    const [total, data] = await Promise.all([
      Maintenance.countDocuments(filter),
 
      Maintenance.find(filter)
        // The list card doesn't need these, and statusHistory grows over time
        .select("-statusHistory -completionProof -idempotencyKey")
        .populate({
          path: "vehicle",
          // Only the first vehicle image is used on the card, so don't
          // send the whole gallery for every row.
          select: {
            vehicleName: 1,
            vehicleNumber: 1,
            manufacturer: 1,
            model: 1,
            variant: 1,
            vehicleType: 1,
            fuelType: 1,
            transmission: 1,
            seatingCapacity: 1,
            status: 1,
            images: { $slice: 1 },
          },
        })
        .populate({
          path: "createdBy",
          select: "name fullName",
        })
        // _id as a tie-breaker keeps pages stable when createdAt is equal
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);
 
    return res.status(200).json({
      success: true,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasMore: skip + data.length < total,
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const getMaintenanceById = async (req, res, next) => {
  try {
    const item = await Maintenance.findOne({
      _id: req.params.id,
      isDeleted: false,
    })
      .populate({ path: "vehicle", select: "vehicleName vehicleNumber images" })
      .populate({ path: "createdBy", select: "name fullName email" })
      .lean();

    if (!item) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    return res.status(200).json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
};

const VALID_STATUSES = ["Scheduled", "In Progress", "Completed", "Cancelled"];
export const updateMaintenanceStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, note, billImage, cardImage } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid maintenance id",
      });
    }

    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${VALID_STATUSES.join(", ")}`,
      });
    }

    // Completing a job requires proof — bill and card photos, plus a note
    if (status === "Completed") {
      if (!billImage || !cardImage) {
        return res.status(400).json({
          success: false,
          message:
            "Bill photo and card photo are required to mark maintenance as completed",
        });
      }
    }

    const maintenance = await Maintenance.findOne({
      _id: id,
      isDeleted: false,
    });

    if (!maintenance) {
      return res.status(404).json({
        success: false,
        message: "Maintenance record not found",
      });
    }

    // No-op if status hasn't actually changed
    if (maintenance.status === status) {
      return res.status(200).json({
        success: true,
        message: "Status unchanged",
        data: maintenance,
      });
    }

    const previousStatus = maintenance.status;

    maintenance.status = status;

    if (status === "Completed") {
      const completionTime = new Date();

      // Actual maintenance completion date & time
      maintenance.completedDate = completionTime;

      // Update endDate to actual completion date & time
      maintenance.endDate = completionTime;

      maintenance.completionProof = {
        billImage,
        cardImage,
        note: note || "",
      };
    } else if (maintenance.completedDate) {
      maintenance.completedDate = null;
    }

    maintenance.statusHistory.push({
      status,
      changedBy: req.user?._id,
      note: note || "",
      changedAt: new Date(),
    });

    await maintenance.save();

    /* ===============================
       COMPLETED -> RESET VEHICLE TO "available" - TEMPORARILY DISABLED
    =============================== */

    // if (status === "Completed") {
    //   try {
    //     const updatedVehicle = await Vehicle.findByIdAndUpdate(
    //       maintenance.vehicle,
    //       {
    //         $set: {
    //           status: "available",
    //           "maintenance.required": false,
    //           "maintenance.currentMaintenance": null,
    //           "maintenance.reason": "",
    //           "maintenance.estimatedDays": 0,
    //           "maintenance.estimatedCompletionDate": null,
    //           "maintenance.markedBy": null,
    //           "maintenance.markedAt": null,
    //         },
    //       },
    //       { new: true },
    //     );

    //     if (!updatedVehicle) {
    //       // Roll back the status change if the vehicle couldn't be updated,
    //       // so the maintenance record and vehicle stay in sync.
    //       maintenance.status = previousStatus;
    //       maintenance.completedDate = null;
    //       maintenance.completionProof = undefined;
    //       maintenance.statusHistory.pop();
    //       await maintenance.save();

    //       return res.status(500).json({
    //         success: false,
    //         message:
    //           "Maintenance was updated but the linked vehicle could not be found to reset its status",
    //       });
    //     }
    //   } catch (vehicleUpdateError) {
    //     // Roll back the status change on error too
    //     maintenance.status = previousStatus;
    //     maintenance.completedDate = null;
    //     maintenance.completionProof = undefined;
    //     maintenance.statusHistory.pop();
    //     await maintenance.save();
    //     throw vehicleUpdateError;
    //   }
    // }

    const populated = await Maintenance.findById(maintenance._id)
      .populate({
        path: "vehicle",
        select:
          "vehicleName vehicleNumber manufacturer model variant vehicleType fuelType transmission seatingCapacity images status",
      })
      .populate({ path: "createdBy", select: "name fullName email" })
      .populate({ path: "statusHistory.changedBy", select: "name fullName" })
      .lean();

    return res.status(200).json({
      success: true,
      message: "Status updated successfully",
      data: populated,
    });
  } catch (error) {
    next(error);
  }
};
