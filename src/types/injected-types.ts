import { Request } from "express";
import { UserType } from "@models/user.model";

  export interface injectedRequest extends Request {
    user: UserType
  }