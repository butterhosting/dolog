export const Route = {
  containers() {
    return "/containers";
  },
  containerLogs(containerId = ":id") {
    return `/containers/${containerId}/logs`;
  },
};
