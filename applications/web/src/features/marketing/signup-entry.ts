import { useLoaderData } from "@tanstack/react-router";
import { offersSeparateSignup, resolveSignupPath } from "@/lib/auth-capabilities";

const useSignupEntry = () => {
  const { authCapabilities } = useLoaderData({ from: "/(marketing)" });

  return {
    offerRegister: offersSeparateSignup(authCapabilities),
    signupPath: resolveSignupPath(authCapabilities),
  } as const;
};

export { useSignupEntry };
