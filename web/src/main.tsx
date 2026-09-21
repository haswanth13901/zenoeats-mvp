import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { store } from "@/app/store";
import { Root } from "@/routes/AppRoutes";

const container = document.getElementById("root");
if (!container) throw new Error("No #root element; index.html is wrong.");

createRoot(container).render(
  <StrictMode>
    <Provider store={store}>
      <Root />
    </Provider>
  </StrictMode>,
);
