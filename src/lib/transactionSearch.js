// Search matching, shared with the server (server/search.js): the dashboard's all-days search and
// the sender / receiver reports run on the server, the selected day's search here — same rules.
export {
  matchesReceiver,
  matchesSearch,
  matchesSender,
  normalizeSearchText,
  receiverDisplay,
} from "../../server/search.js";
