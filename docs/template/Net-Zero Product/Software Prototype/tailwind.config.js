export default {
    content: ["./index.html", "./src/**/*.{ts,tsx}"],
    theme: {
        extend: {
            colors: {
                shell: {
                    950: "#0d0d0d",
                    900: "#111111",
                    800: "#141414",
                    700: "#1a1a1a",
                    600: "#262626"
                }
            },
            boxShadow: {
                soft: "0 8px 24px rgba(0, 0, 0, 0.25)"
            }
        }
    },
    plugins: []
};
