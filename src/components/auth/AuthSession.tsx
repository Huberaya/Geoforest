"use client";

import { createContext, useContext } from "react";

export const AuthSessionContext = createContext({
  provider: "oidc" as "oidc" | "clerk_development" | "clerk_production",
  generation: 0,
  logout: async () => {},
});
export const useAuthSession = () => useContext(AuthSessionContext);
