export interface Fixture {
  scope: string;
  method: string;
  path: string;
  body: string | any;
  status: number;
  response: string | any;
  headers: { [key: string]: string };
  reqheaders: { [key: string]: string };
}
