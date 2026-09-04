ARG PYTHON_IMAGE=refujmaui99ffeuuaf.xuanyuan.run/library/python:3.11-slim

FROM ${PYTHON_IMAGE}

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN pip install --no-cache-dir "oceanbase-mcp==0.0.4"

COPY docker/oceanbase-mcp/start.py /app/start.py

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
  CMD python -c "import socket; s = socket.create_connection(('127.0.0.1', 8000), 2); s.close()"

CMD ["python", "/app/start.py"]
