import type { RouteProps } from "react-router";
import { buildURL } from "../utils/buildUrl";

export const syncKubeconfigRoute: RouteProps = {
  path: "/sync-kubeconfig"
};

export const syncKubeconfigURL = buildURL(syncKubeconfigRoute.path);
