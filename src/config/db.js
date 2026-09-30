import mongoose from "mongoose";

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      autoIndex: false,
      maxPoolSize: 50,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });

    mongoose.connection.on('disconnected', () => console.warn('⚠️  MongoDB disconnected — the driver will reconnect automatically.'));
    mongoose.connection.on('reconnected', () => console.log('🟢 MongoDB reconnected'));
    mongoose.connection.on('error', (err) => console.error('MongoDB error:', err.message));

    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    process.exit(1);
  }
};

export default connectDB;