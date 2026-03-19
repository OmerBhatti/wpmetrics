import React from "react";

export default function App() {
  return (
    <main className="container">
      <h1>Electron + React</h1>
      <p>App: {window.appInfo.name} Cool jjjnnn</p>
      <p>Environment: {window.appInfo.env}</p>
    </main>
  );
}
