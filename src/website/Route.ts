export const Route = {
  svcs() {
    return "/services";
  },
  svcsLogs(svcId = ":id") {
    return `/services/${svcId}/logs`;
  },
};
