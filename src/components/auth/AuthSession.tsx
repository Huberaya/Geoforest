"use client";

import { createContext, useContext } from "react";

export const AuthSessionContext = createContext({
  provider: "oidc" as "oidc" | "clerk_development",
  generation: 0,
  logout: async () => {},
});
export const useAuthSession = () => useContext(AuthSessionContext);
