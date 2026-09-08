import React from "react";
import ReactDOM from "react-dom/client";
import { IPC_CHANNELS } from "../shared/ipc-channels";
import App from "./app.tsx";
import "./index.css";

// biome-ignore lint/style/noNonNullAssertion: index.html always mounts #root
ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);

window.ipcRenderer?.on(IPC_CHANNELS.mainProcessMessage, (message) => {
	console.log(message);
});
