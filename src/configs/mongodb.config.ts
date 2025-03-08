import mongoose from "mongoose";

export async function connectToMongoDB(){
    const mongoURI = `${process.env.MONGO_URI}${process.env.MONGO_DB_NAME}`;
    const {connection} = await mongoose.connect(mongoURI)
    console.log(`MongoDB Connected: ${connection.host}`)
}