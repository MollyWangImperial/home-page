# Alira message presentation

The user requested this shared style for every newly delivered Alira chat message: show three waiting dots with “Alira is typing”, then reveal the message character by character. Deliver consecutive messages in order and reveal their action buttons after the final message finishes. Use `client/src/lib/alira-message-style.ts` and `TypedChatText` rather than inserting new Alira replies as fully visible text. Apply this to greetings, survey replies, assessment and exercise completion, and Settings chat replies. Keep restored chat history readable without replaying it, and respect reduced-motion preferences. Keep read-aloud available.

Do not display random testing scores or marks in Alira’s messages; retain the underlying scores for the existing assessment, planning, and Journey calculations.

Keep Alira’s chat cards in chronological conversation order with `AliraTranscript`. A card stays after the message that introduced it, and later patient messages and Alira replies follow it. Resuming a temporarily hidden question keeps its original position; asking a new question creates a new card turn. Keep card actions connected to the current state and retain the existing flow transitions.

Returning to Alira restores the saved conversation and card positions without replaying already delivered messages. Use `alira-chat-history` for browser-local history. New assessment and exercise events get their own context; ordinary return visits keep their messages, draft, and scroll position. Only newly delivered messages use the typing presentation.
