"use client";

import { useEffect, useRef, useState } from "react";
import { INTAKE_QUESTIONS } from "@/lib/intake/questions";
import {
  INTAKE_PHOTO_ACCEPT,
  MAX_INTAKE_PHOTOS,
  validateIntakePhotoMeta,
} from "@/lib/intake/photos";

interface IntakeClientFormProps {
  token: string;
  leadName: string;
  leadEmail: string;
  leadPhone: string;
}

const SERVICE_CATEGORIES = [
  { value: "painting_finishes",   label: "Painting (interior or exterior)" },
  { value: "general_repairs",     label: "General repairs / patching" },
  { value: "plumbing",            label: "Plumbing" },
  { value: "electrical",          label: "Electrical" },
  { value: "carpentry_furniture", label: "Carpentry / furniture" },
  { value: "outdoor_seasonal",    label: "Outdoor / seasonal" },
  { value: "mounting_installs",   label: "Mounting / installs" },
  { value: "maintenance_small",   label: "Small maintenance task" },
  { value: "specialty_expansion", label: "Major project / renovation" },
  { value: "other",               label: "Not sure / something else" },
] as const;

const TIME_SLOTS = [
  { value: "morning",   label: "Morning (8am–12pm)" },
  { value: "afternoon", label: "Afternoon (12pm–4pm)" },
  { value: "evening",   label: "Evening (4pm–7pm)" },
  { value: "flexible",  label: "Flexible — anytime works" },
];

const REFERRAL_SOURCES = [
  { value: "repeat",          label: "Previous customer" },
  { value: "realtor",         label: "Realtor referral" },
  { value: "friend_neighbor", label: "Friend or neighbor" },
  { value: "online",          label: "Found you online" },
  { value: "other",           label: "Other" },
];

const OWNERSHIP_TYPES = [
  { value: "owner",            label: "Property owner" },
  { value: "realtor",         label: "Realtor / agent" },
  { value: "property_manager", label: "Property manager" },
  { value: "family_member",   label: "Family member" },
  { value: "tenant",          label: "Tenant" },
];

type Step = "details" | "service" | "done";

interface PhotoItem {
  key: string;
  file: File;
  previewUrl: string;
  status: "uploading" | "done" | "failed";
  /** Server id of the stored photo, set once the upload succeeds. */
  mediaId?: string;
  error?: string;
}

export function IntakeClientForm({ token, leadName, leadEmail, leadPhone }: IntakeClientFormProps) {
  const [step, setStep] = useState<Step>("details");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: contact details
  const [name, setName] = useState(leadName);
  const [email, setEmail] = useState(leadEmail);
  const [phone, setPhone] = useState(leadPhone);

  // Step 2: service info
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [intakeAnswers, setIntakeAnswers] = useState<Record<string, string>>({});
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [zip, setZip] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [timeSlot, setTimeSlot] = useState("flexible");
  const [referralSource, setReferralSource] = useState("");
  const [realtorName, setRealtorName] = useState("");
  const [brokerageName, setBrokerageName] = useState("");
  const [ownershipType, setOwnershipType] = useState("");

  const questions = category ? (INTAKE_QUESTIONS[category] ?? []) : [];

  // Photos. Each one uploads as soon as it is picked, so the customer sees
  // upload problems before they submit the form.
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const photosRef = useRef<PhotoItem[]>([]);
  // Keys removed while their upload was still running. The upload deletes its
  // stored photo when it finishes.
  const removedWhileUploading = useRef<Set<string>>(new Set());

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(() => {
    return () => {
      for (const p of photosRef.current) URL.revokeObjectURL(p.previewUrl);
    };
  }, []);

  function patchPhoto(key: string, patch: Partial<PhotoItem>) {
    // Keep status in sync before a submit gesture can race with React renders.
    photosRef.current = photosRef.current.map((p) =>
      p.key === key ? { ...p, ...patch } : p
    );
    setPhotos(photosRef.current);
  }

  async function uploadPhoto(item: PhotoItem) {
    patchPhoto(item.key, { status: "uploading", error: undefined });
    try {
      const body = new FormData();
      body.append("file", item.file);
      const res = await fetch(`/api/intake/${token}/media`, { method: "POST", body });
      const json = (await res.json().catch(() => null)) as
        | { data?: { id?: string }; error?: { message?: string } }
        | null;

      if (!res.ok || !json?.data?.id) {
        patchPhoto(item.key, {
          status: "failed",
          error: json?.error?.message ?? "This photo could not be uploaded. Please try again.",
        });
        return;
      }

      if (removedWhileUploading.current.has(item.key)) {
        removedWhileUploading.current.delete(item.key);
        void fetch(`/api/intake/${token}/media/${json.data.id}`, { method: "DELETE" }).catch(() => undefined);
        return;
      }
      patchPhoto(item.key, { status: "done", mediaId: json.data.id });
    } catch {
      patchPhoto(item.key, {
        status: "failed",
        error: "Network error. Check your connection and try again.",
      });
    }
  }

  function addPhotos(list: FileList | null) {
    if (!list) return;
    const errors: string[] = [];
    const toAdd: PhotoItem[] = [];
    // A ref is updated synchronously so two rapid file-selection events do
    // not each see the same stale React state and exceed the photo cap.
    let room = MAX_INTAKE_PHOTOS - photosRef.current.length;

    for (const file of Array.from(list)) {
      if (room <= 0) {
        errors.push(`You can attach up to ${MAX_INTAKE_PHOTOS} photos.`);
        break;
      }
      const problem = validateIntakePhotoMeta({ type: file.type, size: file.size });
      if (problem) {
        errors.push(`${file.name}: ${problem}`);
        continue;
      }
      room -= 1;
      toAdd.push({
        key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        status: "uploading",
      });
    }

    setPhotoError(errors.length > 0 ? errors.join(" ") : null);
    if (toAdd.length > 0) {
      photosRef.current = [...photosRef.current, ...toAdd];
      setPhotos(photosRef.current);
      for (const item of toAdd) void uploadPhoto(item);
    }
    if (photoInputRef.current) photoInputRef.current.value = "";
  }

  async function removePhoto(item: PhotoItem) {
    setPhotoError(null);
    if (item.status === "uploading") {
      removedWhileUploading.current.add(item.key);
    } else if (item.status === "done" && item.mediaId) {
      try {
        const res = await fetch(`/api/intake/${token}/media/${item.mediaId}`, { method: "DELETE" });
        if (!res.ok) throw new Error("delete failed");
      } catch {
        setPhotoError("That photo could not be removed. Please try again.");
        return;
      }
    }
    URL.revokeObjectURL(item.previewUrl);
    photosRef.current = photosRef.current.filter((p) => p.key !== item.key);
    setPhotos(photosRef.current);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim() || description.trim().length < 20) {
      setError("Please describe your project in at least 20 characters.");
      return;
    }
    if (photosRef.current.some((p) => p.status !== "done")) {
      setError("Please wait for your photos to finish uploading, or remove any that did not upload.");
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/intake/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          service_category: category || "general_repairs",
          service_description: description.trim(),
          intake_metadata: {
            ...intakeAnswers,
            ...(ownershipType ? { ownership_type: ownershipType } : {}),
          },
          referral_source: referralSource || null,
          referral_name: referralSource === "realtor" ? realtorName.trim() || null : null,
          brokerage_name: referralSource === "realtor" ? brokerageName.trim() || null : null,
          address: address.trim(),
          city: city.trim(),
          zip: zip.trim(),
          preferred_date: preferredDate || null,
          preferred_time_slot: timeSlot,
        }),
      });

      if (!res.ok) {
        const json = await res.json() as { error?: { message?: string } };
        setError(json.error?.message ?? "Something went wrong. Please try again.");
        return;
      }

      setStep("done");
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "done") {
    return (
      <div style={{ textAlign: "center", padding: "32px 0" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
        <h2 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 12px" }}>Got it — thank you!</h2>
        <p style={{ fontSize: 15, color: "#52525b", lineHeight: 1.6, margin: "0 0 8px" }}>
          We received your project details and will be in touch within 1 business day.
        </p>
        <p style={{ fontSize: 13, color: "#71717a" }}>
          Dovetails Services LLC · Southern NH &amp; Merrimack Valley MA
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Contact info ──────────────────────────────────────────────── */}
      <fieldset style={fieldsetStyle}>
        <legend style={legendStyle}>Your contact info</legend>

        <div style={fieldStyle}>
          <label style={labelStyle}>Name *</label>
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} required />
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Email *</label>
          <input type="email" style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Phone</label>
          <input type="tel" style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
        </div>
      </fieldset>

      {/* ── Service details ───────────────────────────────────────────── */}
      <fieldset style={fieldsetStyle}>
        <legend style={legendStyle}>Your project</legend>

        <div style={fieldStyle}>
          <label style={labelStyle}>What type of service do you need?</label>
          <select
            style={inputStyle}
            value={category}
            onChange={(e) => { setCategory(e.target.value); setIntakeAnswers({}); }}
            required
          >
            <option value="">— Select a category —</option>
            {SERVICE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>

        {/* Branching questions */}
        {questions.map((q) => (
          <div key={q.key} style={fieldStyle}>
            <label style={labelStyle}>{q.label}</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {q.options.map((opt) => (
                <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, cursor: "pointer" }}>
                  <input
                    type="radio"
                    name={q.key}
                    value={opt.value}
                    checked={intakeAnswers[q.key] === opt.value}
                    onChange={() => setIntakeAnswers((prev) => ({ ...prev, [q.key]: opt.value }))}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
        ))}

        <div style={fieldStyle}>
          <label style={labelStyle}>Describe your project * <span style={{ fontWeight: 400, color: "#71717a" }}>(the more detail, the better)</span></label>
          <textarea
            style={{ ...inputStyle, minHeight: 100, resize: "vertical" }}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. I have two bedrooms that need painting — walls and trim. The current color is dark green and we'd like off-white."
            required
            minLength={20}
          />
          <span style={{ fontSize: 14, color: description.length < 20 ? "#71717a" : "#16a34a" }}>
            {description.length} / 20 characters minimum
          </span>
        </div>

        {/* ── Photos (section 8: "Support photos immediately") ─────────── */}
        <div style={fieldStyle}>
          <label style={labelStyle}>
            Photos <span style={{ fontWeight: 400, color: "#71717a" }}>(optional, up to {MAX_INTAKE_PHOTOS})</span>
          </label>
          <span style={{ fontSize: 14, color: "#52525b" }}>
            Photos of the area or the problem help us quote accurately. Each photo must be 10 MB or smaller.
          </span>
          <input
            ref={photoInputRef}
            type="file"
            accept={INTAKE_PHOTO_ACCEPT}
            multiple
            onChange={(e) => addPhotos(e.target.files)}
            disabled={photos.length >= MAX_INTAKE_PHOTOS}
            style={{ fontSize: 16, marginTop: 4 }}
          />
          {photoError && (
            <p role="alert" style={{ color: "#dc2626", fontSize: 14, margin: "4px 0 0" }}>{photoError}</p>
          )}
          {photos.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "flex", flexWrap: "wrap", gap: 12 }}>
              {photos.map((p) => (
                <li key={p.key} style={{ width: 140, display: "flex", flexDirection: "column", gap: 6 }}>
                  {/* Local blob: URL preview of the customer's own file. next/image cannot load it. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.previewUrl}
                    alt={`Preview of ${p.file.name}`}
                    style={{ width: 140, height: 140, objectFit: "cover", borderRadius: 6, border: "1px solid #d1d5db", background: "#f4f4f5" }}
                  />
                  <span style={{ fontSize: 14, wordBreak: "break-all" }}>{p.file.name}</span>
                  <span style={{ fontSize: 14, color: p.status === "failed" ? "#dc2626" : "#52525b" }}>
                    {p.status === "uploading" ? "Uploading…" : p.status === "done" ? "Added" : "Upload failed"}
                  </span>
                  {p.error && <span style={{ fontSize: 14, color: "#dc2626" }}>{p.error}</span>}
                  {p.status === "failed" && (
                    <button type="button" onClick={() => void uploadPhoto(p)} style={photoButtonStyle}>
                      Try again
                    </button>
                  )}
                  <button type="button" onClick={() => void removePhoto(p)} style={photoButtonStyle}>
                    Remove photo
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </fieldset>

      {/* ── Referral + ownership ──────────────────────────────────────── */}
      <fieldset style={fieldsetStyle}>
        <legend style={legendStyle}>A couple more things</legend>

        <div style={fieldStyle}>
          <label style={labelStyle}>Your relationship to this property</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
            {OWNERSHIP_TYPES.map((o) => (
              <label key={o.value} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, cursor: "pointer" }}>
                <input
                  type="radio"
                  name="ownership_type"
                  value={o.value}
                  checked={ownershipType === o.value}
                  onChange={() => setOwnershipType(o.value)}
                />
                {o.label}
              </label>
            ))}
          </div>
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>How did you hear about us? <span style={{ fontWeight: 400, color: "#71717a" }}>(optional)</span></label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
            {REFERRAL_SOURCES.map((r) => (
              <label key={r.value} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, cursor: "pointer" }}>
                <input
                  type="radio"
                  name="referral_source"
                  value={r.value}
                  checked={referralSource === r.value}
                  onChange={() => setReferralSource(r.value)}
                />
                {r.label}
              </label>
            ))}
          </div>
        </div>

        {referralSource === "realtor" && (
          <>
            <div style={fieldStyle}>
              <label style={labelStyle}>Realtor name <span style={{ fontWeight: 400, color: "#71717a" }}>(optional)</span></label>
              <input
                style={inputStyle}
                value={realtorName}
                onChange={(e) => setRealtorName(e.target.value)}
                placeholder="e.g. Jane Smith"
              />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Brokerage / company <span style={{ fontWeight: 400, color: "#71717a" }}>(optional)</span></label>
              <input
                style={inputStyle}
                value={brokerageName}
                onChange={(e) => setBrokerageName(e.target.value)}
                placeholder="e.g. Coldwell Banker, Keller Williams"
              />
            </div>
          </>
        )}
      </fieldset>

      {/* ── Property & scheduling ─────────────────────────────────────── */}
      <fieldset style={fieldsetStyle}>
        <legend style={legendStyle}>Location &amp; timing</legend>

        <div style={fieldStyle}>
          <label style={labelStyle}>Street address</label>
          <input style={inputStyle} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="123 Main St" />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={fieldStyle}>
            <label style={labelStyle}>City</label>
            <input style={inputStyle} value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>ZIP</label>
            <input style={inputStyle} value={zip} onChange={(e) => setZip(e.target.value)} placeholder="e.g. 03060" />
          </div>
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Preferred start date <span style={{ fontWeight: 400, color: "#71717a" }}>(optional)</span></label>
          <input
            type="date"
            style={inputStyle}
            value={preferredDate}
            min={new Date().toISOString().split("T")[0]}
            onChange={(e) => setPreferredDate(e.target.value)}
          />
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Best time of day</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {TIME_SLOTS.map((ts) => (
              <label key={ts.value} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, cursor: "pointer" }}>
                <input
                  type="radio"
                  name="time_slot"
                  value={ts.value}
                  checked={timeSlot === ts.value}
                  onChange={() => setTimeSlot(ts.value)}
                />
                {ts.label}
              </label>
            ))}
          </div>
        </div>
      </fieldset>

      {error && (
        <p style={{ color: "#dc2626", fontSize: 14, margin: 0 }}>{error}</p>
      )}

      <button
        type="submit"
        disabled={submitting}
        style={{
          background: submitting ? "#71717a" : "#0f172a",
          color: "#fff",
          padding: "14px 24px",
          borderRadius: 6,
          border: "none",
          fontSize: 15,
          fontWeight: 600,
          cursor: submitting ? "not-allowed" : "pointer",
        }}
      >
        {submitting ? "Submitting…" : "Submit my project details"}
      </button>

      <p style={{ fontSize: 12, color: "#71717a", margin: 0 }}>
        By submitting, you agree to be contacted by Dovetails Services LLC regarding your project.
        We won&apos;t share your information.
      </p>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const fieldsetStyle: React.CSSProperties = {
  border: "1px solid #e4e4e7",
  borderRadius: 8,
  padding: "16px 20px",
  margin: 0,
};

const legendStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 14,
  padding: "0 4px",
  color: "#18181b",
};

const fieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  marginTop: 12,
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#374151",
};

const photoButtonStyle: React.CSSProperties = {
  minHeight: 44,
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid #d1d5db",
  background: "#fff",
  fontSize: 15,
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid #d1d5db",
  fontSize: 14,
  background: "#fff",
  width: "100%",
  boxSizing: "border-box",
};
