import type { PostGameButton } from "./postGameButtons.js";
import { seeAnswerButton } from "./seeAnswerButton.js";
import { tellMeMoreButton } from "./tellMeMoreButton.js";

/**
 * The post-game buttons, in render order (top to bottom on the revealed card).
 * "See your answer" is always present; "Tell me more" is gated by the
 * `tellMeMore` cascade. Add a new button by appending its entry here.
 */
export const POST_GAME_BUTTONS: readonly PostGameButton[] = [seeAnswerButton, tellMeMoreButton];
