import { Pattern } from "@/models/Pattern";
import { Range } from "@/website/hooks/objects/Range";

export type ClientFilter = {
  pattern?: Pattern;
  range: Range;
};
