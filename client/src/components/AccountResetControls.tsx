import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { accountResetStore } from "@/lib/account-reset";
import "./account-reset-controls.css";

export default function AccountResetControls() {
  const resetAccount = () => {
    const changed = accountResetStore.reset();
    if (!changed) {
      toast.error("The account could not be reset. Please try again.");
      return;
    }
    // Restart the app too: greetings, conversations and learning stores have memory fallbacks.
    window.location.replace("/");
  };
  return (
    <div className="account-reset-controls">
      <button type="button" className="account-reset-button" onClick={resetAccount} aria-label="Reset account" title="Start again as a newly signed-in user"><RotateCcw size={16} aria-hidden="true" /><span>Reset account</span></button>
    </div>
  );
}
