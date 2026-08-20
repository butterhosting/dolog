import { Pattern } from "@/models/Pattern";
import { Timespan } from "@/website/hooks/objects/Timespan";

export type ClientFilter = {
  pattern?: Pattern;
  timespan: Timespan;
};
