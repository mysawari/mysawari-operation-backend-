const axios = require('axios');

async function run() {
  try {
    const mongoose = require("mongoose");
    const uri = "mongodb+srv://admintech_db_user:8ecIxuNvrEengCuh@cluster0.9vpt6zf.mongodb.net/data";
    await mongoose.connect(uri);
    
    // Get a user to act as admin
    const admin = await mongoose.connection.db.collection("users").findOne({role: "SUPER_ADMIN"});
    
    const jwt = require('jsonwebtoken');
    // Using the secret from my-sawari .env
    const token = jwt.sign({ id: admin._id, role: admin.role, company: admin.company }, 'mysawari_super_secure_access_secret_change_this', { expiresIn: '1h' });
    
    console.log("Sending Push Notification API Request...");
    
    const payload = {
      title: "Automated Test",
      body: "This is a test from the backend!",
      target: "all"
    };

    const res = await axios.post(`http://localhost:5002/api/v1/notifications/send`, payload, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    
    console.log("Response:", JSON.stringify(res.data, null, 2));
    
    await mongoose.disconnect();
  } catch (e) {
    if (e.response) {
      console.error("Error Status:", e.response.status);
      console.error("Error Data:", e.response.data);
    } else {
      console.error("Error:", e.message);
    }
  }
}
run();
