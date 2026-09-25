import { TanStackDevtools } from "@tanstack/react-devtools";
import { formDevtoolsPlugin } from "@tanstack/react-form-devtools";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

export const Devtools = () => (
  <>
    <TanStackDevtools
      config={{ position: "bottom-left" }}
      plugins={[formDevtoolsPlugin()]}
    />
    <TanStackRouterDevtools />
  </>
);
