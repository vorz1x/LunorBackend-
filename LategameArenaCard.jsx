import React from "react";

const LATEGAME_IMAGE = "https://th.bing.com/th/id/OIP.BJ3FmQgEd52Lr4J4DGcEjgHaEK?o=7rm=3&rs=1&pid=ImgDetMain&o=7&rm=3";

export default function LategameArenaCard({ onSelect }) {
  return (
    <div className="gamemode-card" onClick={onSelect} style={{ cursor: "pointer" }}>
      <img
        src={LATEGAME_IMAGE}
        alt="Lategame Arena"
        style={{
          width: "100%",
          height: "auto",
          borderRadius: "16px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)"
        }}
      />
      <h2 style={{ marginTop: "1em" }}>Lategame Arena</h2>
      <p>
        Thank you for playing Lunor!
      </p>
    </div>
  );
}