export class Preview {
    private static instance: Preview;
    private static html: string;
    private static style: string;

    private constructor() {}
    public static getInstance(): Preview {
        if (!this.instance) {
            this.instance = new Preview();
        } 
        return this.instance;
    }
}