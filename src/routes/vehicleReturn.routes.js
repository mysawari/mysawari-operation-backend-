import express from "express";
import protect from "../middlewares/auth.middleware.js";
import { vehicleReturnUpload,returnImageUpload } from "../middlewares/upload.middleware.js";
import { deleteReturnImage, getReturnDetails, getServiceVehicles, getVehicleReturnsDashboard, markVehicleAvailable, receiveVehicle, uploadReturnImage, validateReturnImageRequest } from "../controllers/vehicleReturn.controller.js";

const router = express.Router();

router.use(protect);

router.post("/receive/:handoverId",vehicleReturnUpload,receiveVehicle);
router.get("/details/:handoverId", getReturnDetails);
router.get("/dashboard",protect,getVehicleReturnsDashboard);

// menu/service
router.get("/service",protect,getServiceVehicles);
router.put("/service/complete/:id",protect,markVehicleAvailable);

//new 
router.post("/images/:handoverId/:field",validateReturnImageRequest,returnImageUpload,uploadReturnImage);
router.delete("/images/:handoverId/:field",validateReturnImageRequest,deleteReturnImage);

export default router;