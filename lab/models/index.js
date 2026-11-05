// The models the lab knows. A model is { id, params, create(helpers, arg) → source }, see engine.js.
import cd from "./cd.js";
import text from "./text.js";
import picture from "./picture.js";

export const MODELS = { cd, text, picture };
