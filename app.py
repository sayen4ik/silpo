from flask import Flask, render_template

app = Flask(__name__)

@app.route("/")
def index():
    # віддаємо шаблон з грою
    return render_template("index.html")

# опційно: healthcheck для Render
@app.route("/health")
def health():
    return "ok", 200

if __name__ == "__main__":
    app.run(debug=True)
