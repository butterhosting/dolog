export type Webhook = {
  url: string;
  auth?: {
    username: string;
    password: string;
  };
};
