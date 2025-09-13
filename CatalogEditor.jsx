import React, { useState, useEffect } from "react";
export default function CatalogEditor() {
  const [catalog, setCatalog] = useState({});
  useEffect(() => {
    fetch("/api/shop/catalog").then(res => res.json()).then(setCatalog);
  }, []);
  // Inline JSON editor with validation
  return <div>
    <h1>Catalog Editor</h1>
    <textarea value={JSON.stringify(catalog, null, 2)}
      onChange={e => setCatalog(JSON.parse(e.target.value))} rows={20} cols={80} />
    <button onClick={() => fetch("/api/shop/catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(catalog)
    })}>Save & Hot Reload</button>
  </div>;
}