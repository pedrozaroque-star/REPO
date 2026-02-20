declare module 'intuit-oauth' {
    export default class OAuthClient {
        constructor(config: {
            clientId: string;
            clientSecret: string;
            environment: string;
            redirectUri: string;
        });

        authorizeUri(options: {
            scope: any[];
            state?: string;
        }): string;

        createToken(url: string): Promise<any>;
        refreshUsingToken(refreshToken: string): Promise<any>;
        isAccessTokenValid(): boolean;
        getToken(): any;
        setToken(token: any): void;

        static scopes: {
            Accounting: string;
            Payment: string;
            Payroll: string;
            TimeTracking: string;
            Benefits: string;
            Profile: string;
            Email: string;
            Phone: string;
            Address: string;
            OpenId: string;
            Intuit_name: string;
        };
    }
}
