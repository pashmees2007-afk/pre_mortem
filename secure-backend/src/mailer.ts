import type { Config } from "./config.js";

export interface Mailer {
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

// Provider-agnostic by design: any transactional email API that accepts a bearer token and a JSON body
// can replace this Resend call. Swap the fetch target and body shape; the Mailer interface stays the same.
export function createMailer(config: Config): Mailer {
  if (config.RESEND_API_KEY) {
    return {
      async send(message) {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { authorization: `Bearer ${config.RESEND_API_KEY}`, "content-type": "application/json" },
          body: JSON.stringify({
            from: config.MAIL_FROM ?? "PreMortem <no-reply@premortem.local>",
            to: [message.to],
            subject: message.subject,
            text: message.text,
          }),
        });
        if (!response.ok) throw new Error(`Email delivery failed with status ${response.status}`);
      },
    };
  }
  return {
    // Dev fallback: no provider configured, so the link is only ever visible in server logs, never in an HTTP response.
    async send(message) {
      console.log(`[dev-mailer] To: ${message.to} | Subject: ${message.subject}\n${message.text}`);
    },
  };
}
