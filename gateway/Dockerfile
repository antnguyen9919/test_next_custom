FROM nginx:1.29-alpine
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/nginx.conf
COPY templates /etc/nginx/templates
ENV WEB_UPSTREAM=http://web:3000 API_UPSTREAM=http://api:4000 PY_UPSTREAM=http://py:8000
EXPOSE 8080
