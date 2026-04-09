import mongoose from "mongoose";

let _conn = null;

export async function connectDb(uri) {
  if (_conn && mongoose.connection.readyState === 1) return _conn;
  mongoose.set("strictQuery", true);
  _conn = await mongoose.connect(uri);
  return _conn;
}
