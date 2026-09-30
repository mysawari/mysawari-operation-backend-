import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/mysawari";

mongoose.connect(uri)
  .then(async () => {
    console.log('Connected');
    const db = mongoose.connection.db;
    const vehicles = await db.collection('vehicles').find({}).toArray();
    console.log("Total vehicles:", vehicles.length);
    console.log("Available:", vehicles.filter(v => v.status === 'available').length);
    console.log("Not deleted:", vehicles.filter(v => v.isDeleted === false || v.isDeleted === undefined).length);
    console.log("Available & Not deleted:", vehicles.filter(v => v.status === 'available' && (v.isDeleted === false || v.isDeleted === undefined)).length);
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
