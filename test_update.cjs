const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

async function run() {
  const form = new FormData();
  form.append('vehicleName', 'Test Car Updated');
  // Write a dummy image file
  fs.writeFileSync('dummy.jpg', 'fake image data');
  form.append('images', fs.createReadStream('dummy.jpg'), { filename: 'dummy.jpg', contentType: 'image/jpeg' });
  
  try {
    const mongoose = require("mongoose");
    const uri = "mongodb+srv://admintech_db_user:8ecIxuNvrEengCuh@cluster0.9vpt6zf.mongodb.net/data";
    await mongoose.connect(uri);
    const vehicle = await mongoose.connection.db.collection("vehicles").findOne({});
    const admin = await mongoose.connection.db.collection("users").findOne({role: "SUPER_ADMIN"});
    
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ userId: admin._id, role: admin.role, company: admin.company }, 'mysawari_super_secure_access_secret_change_this', { expiresIn: '1h' });
    
    console.log("Updating vehicle:", vehicle._id);
    
    const res = await axios.put(`http://localhost:5000/api/v1/vehicles/update/${vehicle._id}`, form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${token}`
      }
    });
    console.log("Response:", JSON.stringify(res.data.data.images, null, 2));
    process.exit(0);
  } catch (e) {
    if (e.response) {
      console.error("Error Status:", e.response.status);
      console.error("Error Data:", e.response.data);
    } else {
      console.error("Error:", e.message);
    }
    process.exit(1);
  }
}
run();
